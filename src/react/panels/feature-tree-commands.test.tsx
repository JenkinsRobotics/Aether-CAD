import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolIcon, type TreeNode } from "@aether/ui";
import { cadFeatureActions, cadFeatureItem, cadHistoryCount, cadTreeCommand } from "./feature-tree-commands";
import { itemTreePresentation } from "./item-tree";
const sketch: TreeNode = {id:"feature/sketch/s1",label:"Sketch 1",icon:<ToolIcon name="sketch"/>,actions:[{id:"edit-feature",label:"Edit Sketch 1",icon:null},{id:"suppress-feature",label:"Suppress Sketch 1",icon:null}]};
const revolve: TreeNode = {...sketch,id:"feature/revolve/r1",label:"Revolve 1",icon:<ToolIcon name="part"/>};
const body: TreeNode = {id:"feature/body/b1",label:"Part 1",actions:[{id:"body-visibility",label:"Show Part 1",icon:null},{id:"body-rename",label:"Rename Part 1",icon:null}]};
const rows = [sketch,revolve,body];
function actions(node:TreeNode, selected=new Set([node.id])) {return cadFeatureActions(node,rows,selected,2,true);}
test("CAD consumes the shared action order and only enables connected document commands",()=>{
 const menu=actions(sketch);expect(menu.slice(0,4).map(a=>a.item.label)).toEqual(["Rename","Edit…","Copy sketch","Show dimensions"]);
 for(const id of ["rename","edit","suppress","rollback-here","move-down"])expect(menu.find(a=>a.item.id===id)?.item.disabled).toBe(false);
 for(const id of ["copy-sketch","dimensions","visibility","dynamic-suppression","comment","dependencies"])expect(menu.find(a=>a.item.id===id)?.item.disabled).toBe(true);
 expect(actions(sketch,new Set([sketch.id,revolve.id])).find(a=>a.item.id==="suppress")?.item.disabled).toBe(true);
});
test("shared actions dispatch CAD's existing validated operations",()=>{
 for(const [id,command] of [["suppress",{type:"item-action",id:sketch.id,actionID:"suppress-feature"}],["rollback-here",{type:"rollback-to",index:1}],["move-down",{type:"move-item",id:sketch.id,targetID:revolve.id,position:"after"}],["new-folder-selection",{type:"create-folder",memberIDs:[sketch.id]}]] as const){
  expect(cadTreeCommand(actions(sketch).find(a=>a.item.id===id)!.request,sketch)).toEqual(command);
 }
 expect(cadTreeCommand(actions(body).find(a=>a.item.id==="visibility")!.request,body)).toEqual({type:"item-action",id:body.id,actionID:"body-visibility"});
 expect(cadHistoryCount(rows)).toBe(2);
});
test("suppression, hidden parts and protected reference geometry remain distinct",()=>{
 expect(cadFeatureItem({...sketch,dimmed:true,badge:"Suppressed"})).toMatchObject({suppressed:true,hidden:false});
 expect(cadFeatureItem(body)).toMatchObject({kind:"part",hidden:true});
 const reference:TreeNode={id:"reference/top",label:"Top"};
 const menu=cadFeatureActions(reference,[reference],new Set([reference.id]),0,true);
 expect(menu.find(a=>a.item.id==="rename")?.item.disabled).toBe(true);expect(menu.find(a=>a.item.id==="delete")).toBeUndefined();
});
test("actual CAD types retain their shared icons and default geometry cannot be dragged",()=>{
 const presented=itemTreePresentation([{id:"reference-folder",label:"Reference Geometry",children:[]},revolve]);
 expect(presented[0]).toMatchObject({label:"Default geometry",draggable:false});
 const html=renderToStaticMarkup(<>{presented[1].icon}</>);
 expect(html).toBe(renderToStaticMarkup(<ToolIcon name="revolve"/>));expect(presented[1].dropMode).toBe("reorder");
});

test("rollback indices follow actual document history even when folders reorder presentation",()=>{
 const folder:TreeNode={id:"folder/f1",label:"Folder",children:[revolve,sketch]};
 const menu=cadFeatureActions(revolve,[folder],new Set([revolve.id]),2,true,["s1","r1"]);
 expect(cadTreeCommand(menu.find(a=>a.item.id==="rollback-here")!.request,revolve)).toEqual({type:"rollback-to",index:2});
});
