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
  const priorities=rows(['selection-priority-body-tool','selection-priority-face-tool','selection-priority-edge-tool']).map(item=>({
    ...item,label:`Select ${item.label} Priority`,icon:<AetherIcon name={item.label==='Body'?'cube':item.label==='Face'?'face':'edge'} style={{color:'#38b56b'}}/>,
  }));
  const filters=items.filter(item=>item.id.startsWith('home-select-')&&item.id!=='home-select-auto').map(item=>({
    ...item,label:`Select ${item.label}`,icon:item.id==='home-select-body'||item.id==='home-select-face'?<AetherIcon name={item.id==='home-select-body'?'cube':'face'} style={{color:'#38b56b'}}/>:item.icon,
  }));
  return [
    {...select,label:'Select',kind:undefined,checked:undefined,icon:<SelectionIcon/>},
    ...methods.map((item,index)=>({...item,separatorBefore:index===0})),
    ...(tools.length?[{id:'selection-tools-menu',label:'Selection Tools',separatorBefore:true,children:tools}]:[]),
    ...(priorities.length?[{id:'selection-priority-menu',label:'Selection Priority',children:priorities}]:[]),
    ...(filters.length?[{id:'selection-filters-menu',label:'Selection Filters',children:filters}]:[]),
  ];
}
