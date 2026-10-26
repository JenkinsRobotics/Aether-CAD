import { ASSEMBLY_PART_MIME } from "../assembly/insertion-session";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AetherIcon, DocumentTabBrowser, PanelNotice, NewFileDialog, type DocumentConnection, type DocumentElementTab } from "@aether/ui";
import { NewDesignDialog } from "@aether/ui/new-design";
import { CAD_DESIGN_KINDS, DESIGN_UNIT_OPTIONS } from "@aether/session/library/design-kinds";
import { createNativeFile } from "@aether/session/library/create-native-file";
import { cadPresentation } from "../cad-presentation-store";

import { tabActionItems, tabPartCode, tabURL, type CADTabAction, type CADTabTarget } from '../document-tab-actions';
import { CADDocumentControls } from "./CADDocumentControls";
import { loadDocumentMetadata } from "./CADDocumentSettings";
import { CADTabActionDialog, type CADTabActionResult } from './CADTabActionDialog';
import { CADFileManagerWindow } from "./CADFileManagerWindow";
import { CADTabFolders } from "./CADTabFolders";
import { browserTabStorage, OPEN_FILES_KEY, readTabFolders, type TabFolder } from "../cad-tab-session";
import { CADFilesPanel } from "./CADFilesPanel";
import { CADTabStrip } from "./CADTabStrip";
import { orderedTabs, readTabOrder, reorderTabs } from "../document-tab-state";
import { documentSession } from "../document-session";
import { navigateDocument } from "../document-navigation";

import { drawingFiles } from "../drawing/files";
import type { Project } from "../host-library";
type OpenFile = { id: string; name: string; kind?: "part" | "assembly" | "drawing" };

// Open-file tabs are a per-browser convenience, like an editor's open tabs.
const tabStorage = browserTabStorage;
const readOpenFiles = (): OpenFile[] => {
  try { const value = JSON.parse(tabStorage().getItem(OPEN_FILES_KEY) ?? "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
};
// The tray and the Files panel are two views of these tabs; each re-reads when the other writes.
const LAYOUT_CHANGED = "cad-tab-layout-changed";
const layoutChanged = () => window.dispatchEvent(new Event(LAYOUT_CHANGED));
const writeOpenFiles = (files: OpenFile[]) => { try { tabStorage().setItem(OPEN_FILES_KEY, JSON.stringify(files)); } catch { /* device preference only */ } layoutChanged(); };
const partIcon = <AetherIcon name="cube" data-design-kind="part" />;
const drawingIcon = <AetherIcon name="file-drawing" data-design-kind="drawing" />;
const assemblyIcon = <AetherIcon name="layers" data-design-kind="assembly" />;

/**
 * The bottom tab bar. Inside a Project document it is Onshape's element bar:
 * one tab per Part Studio, Assembly and Drawing, and "+" adds internal items.
 * In a standalone document it is an open-files bar: every document opened
 * here gets a tab. Either way "+" opens the shared "What do you want to
 * design?" dialog; in a project, parts and assemblies are created inside it.
 */

/** `variant="browser"` draws the same tabs, folders and controls as the left Files panel. */
export function CADDocumentTabs({ connection, placement = "bottom", variant = "tray" }: { connection: DocumentConnection; placement?: "bottom" | "header"; variant?: "tray" | "browser" }) {
  const [revisions,setRevisions]=useState<Record<string,{label:string;title:string}>>({});
  const [tabAction,setTabAction]=useState<{target:CADTabTarget;action:CADTabAction}|null>(null);
  const [saveStatus, setSaveStatus] = useState('');
  useEffect(() => {
    const changed = (event: Event) => {
      const state = (event as CustomEvent<{phase:string;durable:boolean;message?:string}>).detail;
      setSaveStatus(state.phase === 'saved' ? 'Saved' : state.phase === 'saving' || state.phase === 'pending' ? 'Saving…' : state.message ?? (state.durable ? 'Saved in this tab' : 'Not saved'));
    };
    document.addEventListener('aether-save-state', changed);
    return () => document.removeEventListener('aether-save-state', changed);
  }, []);
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  const kind = presentation.workspaceMode === "drawing" ? "drawing" : presentation.workspaceMode === "assembly" && !presentation.partOpen ? "assembly" : "part";
  const [project, setProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("Hybrid Design");
  const [openFiles, setOpenFiles] = useState<OpenFile[]>(readOpenFiles);
  const [organizing,setOrganizing] = useState(false);
  const [folders,setFolders] = useState<TabFolder[]>([]);
  const [managing, setManaging] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [units, setUnits] = useState("mm");
  const [navigation, setNavigation] = useState(0);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    const changed = () => setNavigation(value => value + 1);
    window.addEventListener("cad-document-navigation", changed); window.addEventListener("cad-document-saved", changed);
    return () => { window.removeEventListener("cad-document-navigation", changed); window.removeEventListener("cad-document-saved", changed); };
  }, []);
  const search = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const documentID = search.get("document");
  const orderKey = `aether-cad.tab-order:${documentID ?? "files"}`;
  useEffect(() => {
    const read = () => { setOrder(readTabOrder(orderKey)); setOpenFiles(readOpenFiles()); };
    read(); window.addEventListener(LAYOUT_CHANGED, read);
    return () => window.removeEventListener(LAYOUT_CHANGED, read);
  }, [orderKey]);
  const activeID = search.get("part") ?? search.get("assembly") ?? search.get("drawing");
  useEffect(()=>{
    const key=project?(activeID??project.parts[0]?.id):documentID;
    if(!key||!documentID)return;
    let live=true;
    void loadDocumentMetadata().then(meta=>{
      if(!live)return;
      const historical=search.has('revision');
      const label=historical?`Revision ${meta.revision}`:meta.settings.workspaceName==='Main'?'V1.0':meta.settings.workspaceName;
      setRevisions(previous=>({...previous,[key]:{label,title:historical?`Read-only saved revision ${meta.revision}`:`${label} · ${meta.settings.workspaceName} workspace`}}));
    }).catch(()=>{});
    return()=>{live=false;};
  },[documentID,activeID,project,navigation,presentation.documentName]);
  const folderKey = `aether-cad.tab-groups:${project ? documentID : "files"}`;
  const folderStorage = () => project ? localStorage : tabStorage();
  useEffect(()=>{
    const read=()=>setFolders(readTabFolders(folderStorage(),folderKey));
    read();window.addEventListener(LAYOUT_CHANGED,read);
    return()=>window.removeEventListener(LAYOUT_CHANGED,read);
  },[folderKey]);
  const updateFolders=(next:TabFolder[])=>{setFolders(next);try{folderStorage().setItem(folderKey,JSON.stringify(next));}catch{/* organization remains usable without storage */}layoutChanged();};
  useEffect(() => {
    let disposed = false;
    void import("../host-library").then(({ activeProject, hostedDocumentName }) => {
      if (disposed) return;
      setProject(activeProject);
      setProjectName(hostedDocumentName() ?? "Hybrid Design");
      // Do not register a project's temporary loading draft as a standalone file.
      if (activeProject && documentID) {
        const files = readOpenFiles().filter(file => file.id !== documentID);
        writeOpenFiles(files); setOpenFiles(files); return;
      }
      if (!documentID || presentation.backendState !== "ready" || (!presentation.partOpen && kind !== "assembly" && kind !== "drawing")) return;
      const files = readOpenFiles();
      const entry: OpenFile = { id: documentID, name: presentation.documentName, kind };
      const next = files.some(file => file.id === documentID) ? files.map(file => file.id === documentID ? entry : file) : [...files, entry];
      writeOpenFiles(next);
      setOpenFiles(next);
    });
    return () => { disposed = true; };
  }, [navigation, documentID, presentation.documentName, presentation.backendState, presentation.partOpen, kind]);

  const go = async (url: string) => {
    setError("");
    try { await connection.flush(); await navigateDocument(url); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };

  const inProject = (kind: string) => Boolean(project) && ["part", "assembly", "drawing"].includes(kind);
  const create = async (kind: string, name: string) => {
    await connection.flush();
    if (kind === "hybrid-from-part") {
      const { currentEditorSnapshot } = await import("../host-library");
      const { parsePartDocument } = await import("@aether/core/document");
      const { createDesignFromPart } = await import("../design/create-from-part");
      const snapshot = currentEditorSnapshot();
      if (!snapshot) throw Error("Wait for this Part to finish loading.");
      await navigateDocument(await createDesignFromPart(name, parsePartDocument(new TextDecoder().decode(snapshot.bytes)), documentID));
      return;
    }
    if (kind === "drawing") { await drawingFiles.create(name); await drawingFiles.save(); return; }
    if (inProject(kind) && (kind === "part" || kind === "assembly")) {
      const { editHostedProject, projectItemURL } = await import("../host-library");
      const result = await editHostedProject("add_" + kind, name);
      const item = (kind === "part" ? result.project.parts : result.project.assemblies).at(-1)!;
      await navigateDocument(projectItemURL(item.id, kind));
      return;
    }
    const created = await createNativeFile<{ id: string }>("cad", kind, name, { scope: "personal", parent: null });
    await navigateDocument(`/cad/index.html?document=${encodeURIComponent(created.id)}`);
  };
  const dialogs = <>
    {choosing && <NewDesignDialog kinds={CAD_DESIGN_KINDS.map(item => item.id === "drawing" ? { ...item, unavailable: presentation.partOpen || kind === "drawing" ? undefined : "Open a source Part to create its drawing." } : item)} learnMoreHref="https://github.com/aether-studio"
      units={{ label: "Unit System", value: units, onChange: setUnits, options: DESIGN_UNIT_OPTIONS }}
      onClose={() => setChoosing(false)} onCreate={(kind) => { setChoosing(false); setCreating(kind); }} />}
    {creating && <NewFileDialog title={creating === "hybrid-from-part" ? "Create Hybrid design from this Part" : `New ${creating}`} directory={inProject(creating) ? projectName : "My files"}
      onClose={() => setCreating(null)} onCreate={(name) => create(creating, name)} />}
  </>;

  let tabs: DocumentElementTab[];
  if (project) {
    const openElement = async (id: string, kind: "part" | "assembly" | "drawing") => {
      const { projectItemURL } = await import("../host-library");
      await go(projectItemURL(id, kind));
    };
    tabs = [
      ...project.parts.map((part, index) => ({ id: part.id, label: part.name, detail: "Part Studio", icon: partIcon,
        // A project opens on its first part when no element is named.
        current: activeID ? part.id === activeID : kind === "part" && index === 0, onSelect: () => void openElement(part.id, "part") })),
      ...project.assemblies.map((assembly) => ({ id: assembly.id, label: assembly.name, detail: "Assembly", icon: assemblyIcon,
        current: assembly.id === activeID, onSelect: () => void openElement(assembly.id, "assembly") })),
      ...(project.drawings ?? []).map(drawing => ({ id: drawing.id, label: drawing.name, detail: "Drawing", icon: drawingIcon,
        current: drawing.id === activeID, onSelect: () => void openElement(drawing.id, "drawing") })),
    ];
  } else {
    // An unsaved draft gets its own tab after the files already open.
    const files = documentID ? openFiles : [...openFiles, { id: "draft", name: presentation.documentName, kind }];
    const close = (id: string) => {
      const next = openFiles.filter(file => file.id !== id);
      writeOpenFiles(next);
      setOpenFiles(next);
      if (id === documentID) void go(next.length ? `/cad/index.html?document=${encodeURIComponent(next.at(-1)!.id)}` : "/cad/");
    };
    tabs = files.map(file => ({ id: file.id, label: file.name, detail: file.kind === "drawing" ? "Drawing" : file.kind === "assembly" ? "Assembly" : "Part Studio", icon: file.kind === "drawing" ? drawingIcon : file.kind === "assembly" ? assemblyIcon : partIcon,
      current: file.id === (documentID ?? "draft"),
      onSelect: () => void go(`/cad/index.html?document=${encodeURIComponent(file.id)}`),
      onClose: file.id === "draft" ? undefined : () => close(file.id) }));
  }
  if (project) tabs = orderedTabs(tabs, order);
  const reorder = (source: string, target: string) => {
    const next = reorderTabs(tabs.map(tab => tab.id), source, target);
    if (project) {
      setOrder(next); try { localStorage.setItem(orderKey, JSON.stringify(next)); } catch { /* preference only */ } layoutChanged();
    } else { const files = orderedTabs(openFiles, next); writeOpenFiles(files); setOpenFiles(files); }
  };
  const detach = (id: string) => {
    if (id === "draft") return;
    // Open synchronously during the gesture, before asynchronous saving loses activation.
    const child = window.open('about:blank', '_blank', 'popup,width=1200,height=850');
    if (!child) { setError("Allow popups for Aether CAD to open a separate window."); return; }
    child.opener = null;
    void (async () => {
      try {
        await connection.flush();
        const { projectItemURL } = await import("../host-library");
        const kind = project?.drawings?.some(item => item.id === id) ? "drawing" : project?.assemblies.some(item => item.id === id) ? "assembly" : "part";
        const target = new URL(project ? projectItemURL(id, kind) : `/cad/index.html?document=${encodeURIComponent(id)}`, location.origin);
        target.searchParams.set("isolated", "1");
        child.sessionStorage.setItem(OPEN_FILES_KEY, "[]");
        child.location.replace(target.href);
        if (!project) {
          const remaining = openFiles.filter(file => file.id !== id);
          writeOpenFiles(remaining); setOpenFiles(remaining);
          if (id === documentID) await go(remaining.length ? `/cad/index.html?document=${encodeURIComponent(remaining.at(-1)!.id)}` : '/cad/');
        }
      } catch (error) { child.close(); setError(error instanceof Error ? error.message : String(error)); }
    })();
  };
  const targetFor=(id:string):CADTabTarget=>{
    const tab=tabs.find(tab=>tab.id===id)!;
    const contextual=Boolean(project)||Boolean(tab.current&&documentID);
    return {id,name:tab.label,kind:tab.detail==='Drawing'?'drawing':tab.detail==='Assembly'?'assembly':'part',current:Boolean(tab.current),
      documentId:project?documentID:id==='draft'?null:id,itemId:project?id:undefined,
      branch:contextual?search.get('branch')??undefined:undefined,
      revision:contextual&&search.has('revision')?Number(search.get('revision')):undefined,
      linked:project?.parts.find(part=>part.id===id)?.source?.kind==='linked'};
  };
  // Part previews for the Files panel, built on this device by the same engine.
  // Navigation refreshes them all; a save refreshes the open part's.
  const [thumbnails,setThumbnails]=useState<Record<string,string>>({});
  const partTabs=variant==="browser"?(project ? tabs : tabs.filter(tab=>tab.current)).filter(tab=>tab.detail==="Part Studio").map(tab=>tab.id):[];
  const currentPart=partTabs.find(id=>tabs.find(tab=>tab.id===id)?.current);
  const preview=(ids:string[])=>{
    let live=true;
    void (async()=>{
      const {previewDocument}=await import("../preview-document");
      // ponytail: one engine build per part; cache by document revision if projects grow large.
      for(const id of ids){
        const image=await tabPartCode(targetFor(id)).then(previewDocument).catch(()=>null);
        if(!live)return;
        if(image)setThumbnails(previous=>({...previous,[id]:image}));
      }
    })();
    return()=>{live=false;};
  };
  useEffect(()=>partTabs.length?preview(partTabs):undefined,[partTabs.join(","),navigation,presentation.backendState]);
  useEffect(()=>saveStatus==="Saved"&&currentPart?preview([currentPart]):undefined,[saveStatus,currentPart]);
  const runTabAction=(id:string,action:string)=>{
    const target=targetFor(id),entry=tabActionItems(target).find(item=>item.id===action);
    if(!entry||entry.disabled)return;
    if(action==='open-browser') {
      // Open within user activation, then flush. This keeps the source tab in place.
      const child=window.open('about:blank','_blank');
      if(!child){setError('Allow browser tabs for Aether CAD, then try again.');return;}
      child.opener=null;
      void connection.flush().then(()=>{
        const url=new URL(tabURL(target),location.origin);url.searchParams.set('isolated','1');
        child.sessionStorage.setItem(OPEN_FILES_KEY,'[]');child.location.replace(url.href);
      }).catch(error=>{child.close();setError(error instanceof Error?error.message:String(error));});
    } else setTabAction({target,action:action as CADTabAction});
  };
  const actionApplied=({action,target,name,copy}:CADTabActionResult)=>{
    setTabAction(null);
    if(copy) {
      const url=tabURL({...target,documentId:copy.id,itemId:copy.itemId,revision:undefined,branch:copy.itemId?target.branch:undefined});
      // Project mutations changed the container revision. Reload its authoritative archive.
      if(project)location.assign(url);else void go(url);
      return;
    }
    if(project) {
      const query=new URLSearchParams(location.search);
      if(action==='delete'&&target.current){query.delete('part');query.delete('assembly');query.delete('drawing');}
      location.assign(location.pathname+'?'+query);return;
    }
    const next=action==='delete'?openFiles.filter(file=>file.id!==target.id):openFiles.map(file=>file.id===target.id&&name?{...file,name}:file);
    writeOpenFiles(next);setOpenFiles(next);
    if(target.current) {
      if(action==='delete')void go(next.length?`/cad/index.html?document=${encodeURIComponent(next.at(-1)!.id)}`:'/cad/');
      else location.assign(location.href);
    }
  };
  const designReadOnly = search.has("revision") || documentSession()?.writable === false;
  const creation = project ? {
    label: "Create in this design",
    items: [
      { id: "part", label: "Create Part Studio…", disabled: designReadOnly },
      { id: "assembly", label: "Create Assembly…", disabled: designReadOnly },
      { id: "drawing", label: "Create Drawing…", disabled: designReadOnly || (!presentation.partOpen && kind !== "drawing"),
        disabledReason: "Open a source Part in this design first." },
    ],
    onSelect: (kind: string) => setCreating(kind),
  } : variant === "browser" ? {
    label: "Design actions",
    items: [{ id: "hybrid-from-part", label: "Create Hybrid design from this Part…", disabled: kind !== "part" || !presentation.partOpen,
      disabledReason: "Open a Part to copy into a Hybrid design." }],
    onSelect: (kind: string) => setCreating(kind),
  } : undefined;
  const designTabs = project ? tabs : tabs.filter(tab => tab.current).map(tab => ({ ...tab, onClose: undefined }));
  const controls={creation,revisionForTab:(id:string)=>revisions[id]??{label:'V1.0',title:'Working version V1.0'},tabActions:(id:string)=>tabActionItems(targetFor(id)),onTabAction:runTabAction,saveStatus,tabs,
    label:project ? "Project tabs" : "Open files",folders,onFoldersChange:updateFolders,onOrganize:()=>setOrganizing(true),onManage:() => setManaging(true),onAdd:() => setChoosing(true),onReorder:reorder,onDetach:detach};
  return <>
    {variant !== "browser" && <PanelNotice message={error}/>}
    {variant === "browser"
      ? <CADFilesPanel error={error} documentID={documentID} connection={connection} onDesignDragStart={event => {
          const id = (event.target as Element).closest('[data-document-tab-id]')?.getAttribute('data-document-tab-id');
          if (!id || !project?.id || !project.parts.some(part => part.id === id)) return;
          event.dataTransfer.setData(ASSEMBLY_PART_MIME, JSON.stringify({ kind: 'design-part', workspaceId: project.id, partId: id }));
          event.dataTransfer.effectAllowed = 'copyMove';
        }}>
          <DocumentTabBrowser {...controls} key={documentID ?? "draft"} title={project ? "Design contents" : "Current document"}
            rootLabel={project ? projectName : `${presentation.documentName} · Standalone ${kind}`}
            folders={project ? folders : []} onFoldersChange={project ? updateFolders : undefined} onOrganize={project ? controls.onOrganize : undefined}
            onManage={project ? controls.onManage : undefined}
            tabs={designTabs.map(tab=>({...tab,thumbnail:thumbnails[tab.id]}))} />
        </CADFilesPanel>
      : <CADTabStrip {...controls} leading={<CADDocumentControls name={presentation.documentName} partOpen={presentation.partOpen} menuOnly />} placement={placement} />}
    {managing && <CADFileManagerWindow tabs={tabs} project={project ? {name:projectName,linkedIds:project.parts.filter(part=>part.source?.kind==='linked').map(part=>part.id)} : null} standaloneTabs={project ? openFiles.map(file=>({id:file.id,label:file.name,detail:file.kind==='drawing'?'Drawing':file.kind==='assembly'?'Assembly':'Part Studio',icon:file.kind==='drawing'?drawingIcon:file.kind==='assembly'?assemblyIcon:partIcon,onSelect:()=>void go(`/cad/index.html?document=${encodeURIComponent(file.id)}`)})) : []} connection={connection} onClose={() => setManaging(false)} />}
    {organizing && <CADTabFolders tabs={tabs} folders={folders} onChange={updateFolders} onClose={()=>setOrganizing(false)}/>}
    {tabAction&&<CADTabActionDialog target={tabAction.target} action={tabAction.action} flush={connection.flush} onClose={()=>setTabAction(null)} onApplied={actionApplied}/>}
    {dialogs}
  </>;
}
