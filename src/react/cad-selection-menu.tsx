import { AetherIcon, SelectionIcon, type MenuItem } from '@aether/ui';

export function selectionMenu(items: readonly MenuItem[]): MenuItem[] {
  const byId=new Map(items.map(item=>[item.id,item]));
  const select=byId.get('home-select-auto');
  if(!select)return [...items];
  const rows=(ids:string[])=>ids.flatMap(id=>byId.get(id)?[byId.get(id)!]:[]);
  const methods=rows(['selection-window-tool','selection-freeform-tool','selection-paint-tool']).map(item=>({
    ...item, shortcut:item.id==='selection-window-tool'?'1':item.id==='selection-freeform-tool'?'2':'3', icon:item.id==='selection-window-tool'?<SelectionIcon mode="window"/>:<AetherIcon name={item.id==='selection-freeform-tool'?'lasso':'brush'} style={{color:'#38b56b'}}/>,
  }));
  const tools=rows(['selection-directional-tool','selection-crossing-tool','selection-clear-tool']);
  return [
    {...select,label:'Select',kind:undefined,checked:undefined,icon:<SelectionIcon/>},
    ...methods.map((item,index)=>({...item,separatorBefore:index===0})),
    ...(tools.length?[{id:'selection-tools-menu',label:'Selection Tools',separatorBefore:true,children:tools}]:[]),
  ];
}
