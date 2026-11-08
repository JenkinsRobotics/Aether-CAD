import { ApplicationHome } from '@aether/session/home';
import type { AppHomeDefinition } from '@aether/session/home/types';
import { createDocument } from '../create-document';
import { readAetherCAD, writeAetherCAD } from '../document/aethercad-archive';
import { CADWhatsNew } from './CADWhatsNew';
import { CAD_DESIGN_KINDS, DESIGN_UNIT_OPTIONS } from './design-kinds';
import { localProjectOperation } from '../document/local-project';

export const homeDefinition: AppHomeDefinition = {
    brand: "Aether CAD",
    navigation: [{id:'examples',label:'Examples',icon:'file-project',href:'./?examples=1'}],
    appIcon: "cad",
    appUrl: "./index.html",
    accept: ".aethercad,.step,.stp",
    uploadPattern: /\.(aethercad|step|stp)$/i,
    uploadHint: "Import a .aethercad document or a STEP file.",
    heroLead: "Create a part, pick up recent work, or bring an existing design into your library.",
    emptyHint: "Create a Part or import a design to get started.",
    fallbackIcon: "file-project",
    types: [
      { id: "document", label: "Documents", icon: "file-project", test: /\.aethercad$/i },
    ],
    menu: [["design","New design…","file-part"],["folder","Folder","file-folder"],["part","Part","file-part"],["assembly","Assembly","file-assembly"],["import","Import file…","import"]],
    start: [
      { kind: "part", title: "Part", tagline: "Model exact solid geometry", icon: "file-part", action: "new-doc" },
      { kind: "assembly", title: "Assembly", tagline: "Mate parts into mechanisms", icon: "file-assembly", action: "dialog" },
      { kind: "drawing", title: "Drawing", tagline: "Dimensioned sheets — open a document", icon: "file-drawing", tooltip: "Drawing sheets are created inside an open Part or Assembly document." },
    ],
  welcome:<CADWhatsNew/>, design:{kinds:CAD_DESIGN_KINDS,units:DESIGN_UNIT_OPTIONS}, preview:{accept:/\.aethercad$/i,render:async(text)=>(await import('../preview-document')).previewDocument(text)},create:async(kind,name,{storage,destination,preferences})=>{
      if(kind==='assembly'||kind==='project') {
        if(!storage.hosted) {
          const result = await localProjectOperation('create', {name, packaging:kind, operation_id:crypto.randomUUID()});
          if (!result.data_base64) throw new Error('The CAD runtime returned no design.');
          const bytes = Uint8Array.from(atob(result.data_base64), c => c.charCodeAt(0));
          return storage.createFile(new File([bytes], /\.aethercad$/i.test(name) ? name : `${name}.aethercad`, {type:'application/vnd.aether.workspace+zip'}), destination);
        }
        return storage.request('/api/library/project_create',{app:'cad',name,packaging:kind,...destination});
      }
      const file=createDocument(name);
      // Apply display units to the product document before the first save.
      const {graph}=readAetherCAD(new Uint8Array(await file.arrayBuffer()));
      const settings=graph.document_settings as {units?:object}|undefined;
      graph.document_settings={...settings,units:{...settings?.units,length:{unit:preferences.lengthUnit,decimals:preferences.decimals},angle:{unit:preferences.angleUnit,decimals:preferences.decimals}}};
      return storage.createFile(new File([writeAetherCAD(graph)],file.name,{type:file.type}),destination);
    },
};
export function Home(){return <ApplicationHome definition={homeDefinition}/>;}
