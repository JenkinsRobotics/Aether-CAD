import { ApplicationHome } from '@aether/session/home';
import type { AppHomeDefinition } from '@aether/session/home/types';
import { createDocument } from '../create-document';
import { CADWhatsNew } from './CADWhatsNew';
import { CAD_DESIGN_KINDS, DESIGN_UNIT_OPTIONS } from './design-kinds';

export const homeDefinition: AppHomeDefinition = {
    brand: "Aether CAD",
    navigation: [{id:'examples',label:'Examples',icon:'file-project',href:'./?examples=1'}],
    appIcon: "cad",
    appUrl: "./index.html",
    accept: ".acpart,.acad,.acasm,.cadpart,.aether,.step,.stp",
    uploadPattern: /\.(acpart|acad|acasm|cadpart|aether|step|stp)$/i,
    uploadHint: "Import an .acpart, .acad, .acasm, .step or legacy CAD file.",
    heroLead: "Create a part, pick up recent work, or bring an existing design into your library.",
    emptyHint: "Create a Part or import a design to get started.",
    fallbackIcon: "file-part",
    types: [
      { id: "part", label: "Parts", icon: "file-part", test: /\.(acpart|cadpart)$/ },
      { id: "assembly", label: "Assemblies", icon: "file-assembly", test: /\.(acasm|aether)$/ },
      { id: "drawing", label: "Drawings", icon: "file-drawing", test: /\.(acdrw|acdraw)$/ },
      { id: "project", label: "Hybrid Designs", icon: "file-project", test: /\.acad$/ },
    ],
    menu: [["design","New design…","file-part"],["project","Hybrid Design","file-project"],["folder","Folder","file-folder"],["part","Part","file-part"],["assembly","Assembly","file-assembly"],["import","Import file…","import"]],
    start: [
      { kind: "part", title: "Part", tagline: "Model exact solid geometry", icon: "file-part", action: "new-doc" },
      { kind: "assembly", title: "Assembly", tagline: "Mate parts into mechanisms", icon: "file-assembly", action: "dialog" },
      { kind: "drawing", title: "Drawing", tagline: "Dimensioned sheets — open a document", icon: "file-drawing", tooltip: "Drawing sheets are created inside an open Part or Assembly document." },
      { kind: "project", title: "Hybrid Design", tagline: "Combine parts and assemblies", icon: "file-project", action: "dialog" },
    ],
  welcome:<CADWhatsNew/>, design:{kinds:CAD_DESIGN_KINDS,units:DESIGN_UNIT_OPTIONS}, preview:{accept:/\.(acpart|cadpart)$/i,render:async(text)=>(await import('../preview-document')).previewDocument(text)},create:async(kind,name,{storage,destination,preferences})=>{
      if(kind==='assembly'||kind==='project') {
        if(!storage.hosted) throw new Error('Assembly and Hybrid creation require a running CAD engine. Import an existing design, or create a Part to work locally.');
        return storage.request('/api/library/project_create',{app:'cad',name,packaging:kind,...destination});
      }
      const file=createDocument(name);
      // Apply display units to the product document before the first save.
      const document=JSON.parse(await file.text());
      document.document_settings={...document.document_settings,units:{...document.document_settings?.units,length:{unit:preferences.lengthUnit,decimals:preferences.decimals},angle:{unit:preferences.angleUnit,decimals:preferences.decimals}}};
      return storage.createFile(new File([JSON.stringify(document)],file.name,{type:file.type}),destination);
    },
};
export function Home(){return <ApplicationHome definition={homeDefinition}/>;}
