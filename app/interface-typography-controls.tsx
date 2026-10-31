"use client";
import {useEffect,useRef,useState} from 'react';
import {interfaceFontStack,loadInterfaceTypography,normalizeInterfaceTypography,saveInterfaceTypography,TYPOGRAPHY_EVENT,TYPOGRAPHY_KEYS} from './interface-typography';
import type {InterfaceTypography} from './interface-typography';
import {importInterfaceFont,listInterfaceFonts,loadInterfaceFont} from './interface-fonts';
import type {InterfaceFontBridge} from './interface-fonts';

export function useInterfaceTypography(bridge?: InterfaceFontBridge) {
  const [value,setValue]=useState<InterfaceTypography>(loadInterfaceTypography);
  useEffect(()=>{
    const sync=()=>setValue(loadInterfaceTypography());
    const storage=(event:StorageEvent)=>{if(event.key===null || TYPOGRAPHY_KEYS.some(key=>key===event.key))sync();};
    window.addEventListener(TYPOGRAPHY_EVENT,sync);
    window.addEventListener('piclite:settings-changed',sync);
    window.addEventListener('storage',storage);sync();
    return()=>{window.removeEventListener(TYPOGRAPHY_EVENT,sync);window.removeEventListener('piclite:settings-changed',sync);window.removeEventListener('storage',storage);};
  },[]);
  useEffect(()=>{document.documentElement.style.setProperty('--interface-font-scale',String(value.interfaceFontScale/100));},[value.interfaceFontScale]);
  useEffect(()=>{
    let cancelled=false;
    const root=document.documentElement;
    if(!value.interfaceFontFamily){delete root.dataset.interfaceFont;root.style.removeProperty('--interface-font-family');return;}
    // Keep a usable fallback while decoding, never hide UI text.
    root.dataset.interfaceFont='loading';
    root.style.setProperty('--interface-font-family',interfaceFontStack(value.interfaceFontFamily,value.interfaceFontId));
    void loadInterfaceFont(value.interfaceFontFamily,value.interfaceFontId,bridge).then(()=>{if(!cancelled)root.dataset.interfaceFont='ready';},()=>{if(!cancelled){delete root.dataset.interfaceFont;root.style.removeProperty('--interface-font-family');}});
    return()=>{cancelled=true;};
  },[bridge,value.interfaceFontFamily,value.interfaceFontId]);
  const update=(patch:Partial<InterfaceTypography>)=>setValue(saveInterfaceTypography({...loadInterfaceTypography(),...patch}));
  return [value,update] as const;
}

export function InterfaceTypographyControls({language,bridge}:{language:'zh'|'en';bridge?:InterfaceFontBridge}) {
  const [value,update]=useInterfaceTypography(bridge);
  const [fonts,setFonts]=useState<Array<{family:string;id:string}>>([]);
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const interfaceFontInputRef=useRef<HTMLInputElement>(null);
  const zh=language==='zh';
  const common=['Arial','Helvetica','Segoe UI','Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Georgia'];
  useEffect(()=>{void listInterfaceFonts().then(fonts=>setFonts(fonts.map(({id,family})=>({id,family}))),()=>undefined);},[bridge]);
  const chooseFont=async(family:string,id='')=>{
    setBusy(true);setStatus('');
    try {await loadInterfaceFont(family,id,bridge);update({interfaceFontFamily:family,interfaceFontId:id});}
    catch(error){setStatus(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);}
  };
  const scanFonts=async()=>{
    if(!bridge)return;setBusy(true);setStatus('');
    try {const found=await bridge.listSystemFonts();setFonts(current=>[...current.filter(font=>font.id),...Array.from(new Set(found.map(font=>font.family))).sort().map(family=>({family,id:''}))]);setStatus(zh?'系统字体已载入':'System fonts loaded');}
    catch(error){setStatus(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);}
  };
  const options=Array.from(new Map([...common.map(family=>({family,id:''})),...fonts,{family:value.interfaceFontFamily,id:value.interfaceFontId}].filter(font=>font.family).map(font=>[font.id||font.family,font])).values());
  return <section className="interface-typography-controls" aria-label={zh?'界面文字':'Interface text'}>
    <div className="interface-type-row"><label htmlFor="interface-font-scale">{zh?'界面字号':'Text size'}</label><div><input id="interface-font-scale" type="range" min="90" max="150" step="5" value={value.interfaceFontScale} aria-valuetext={`${value.interfaceFontScale}%`} onChange={event=>update({interfaceFontScale:Number(event.target.value)})}/><output htmlFor="interface-font-scale">{value.interfaceFontScale}%</output></div></div>
    <div className="interface-type-row"><label htmlFor="interface-font-family">{zh?'界面字体':'Interface font'}</label><select id="interface-font-family" disabled={busy} value={value.interfaceFontId||value.interfaceFontFamily} onChange={event=>{const option=options.find(font=>(font.id||font.family)===event.target.value);void chooseFont(option?.family||'',option?.id||'');}}><option value="">{zh?'跟随系统（默认）':'System default'}</option>{options.map(font=><option key={font.id||font.family} value={font.id||font.family}>{font.family}{font.id?(zh?'（已导入）':' (Imported)'):''}</option>)}</select></div>
    <div className="interface-type-actions">{bridge&&<button type="button" disabled={busy} onClick={()=>void scanFonts()}>{zh?'读取系统字体':'Scan system fonts'}</button>}<button type="button" disabled={busy} onClick={()=>interfaceFontInputRef.current?.click()}>{zh?'导入界面字体':'Import interface font'}</button><button type="button" disabled={busy} onClick={()=>{update(normalizeInterfaceTypography());setStatus('');}}>{zh?'恢复默认':'Reset'}</button></div>
    <input className="visually-hidden" ref={interfaceFontInputRef} data-interface-font-input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;setBusy(true);setStatus('');try{const font=await importInterfaceFont(file,bridge);setFonts(current=>[...current.filter(item=>item.id!==font.id),font]);update({interfaceFontFamily:font.family,interfaceFontId:font.id});setStatus(zh?'界面字体已导入并保存':'Interface font imported and saved');}catch(error){setStatus(error instanceof Error?error.message:String(error));}finally{setBusy(false);}}}/>
    <p className="interface-type-preview">PicLite · {zh?'界面文字预览，清晰舒适 123456':'Interface text preview 123456'}</p>
    <small>{zh?'只调整界面文字，不影响图片、水印或导出。导入字体仅保存在本机。':'Changes UI text only, not images, watermarks or exports. Imported fonts stay on this device.'}</small>
    {status&&<p role="status">{status}</p>}
  </section>;
}
