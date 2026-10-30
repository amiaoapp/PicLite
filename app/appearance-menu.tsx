"use client";
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../desktop/clop-icons';
import { useMaterialPreference } from './liquid-glass-theme';

type Props={ language:'zh'|'en'; theme:'system'|'light'|'dark';onTheme:(value:'system'|'light'|'dark')=>void; layout:'classic'|'studio';onLayout:(value:'classic'|'studio')=>void;palette:'graphite'|'mist'|'violet'|'green'|'white';onPalette:(value:'graphite'|'mist'|'violet'|'green'|'white')=>void };
export function AppearanceMenu({language,theme,onTheme,layout,onLayout,palette,onPalette}:Props){
  const [open,setOpen]=useState(false);
  const [material,choose]=useMaterialPreference();
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const zh=language==='zh';
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
  },[open]);
  return <div className="appearance-menu" ref={root}>
    <button ref={trigger} className="appearance-trigger" type="button" aria-label={zh?'外观设置':'Appearance'} title={zh?'外观设置':'Appearance'} aria-expanded={open} aria-controls="appearance-panel" onClick={()=>setOpen(value=>!value)}><Icon name="sun"/></button>
    {open&&<section id="appearance-panel" className="appearance-panel glass-surface" aria-label={zh?'外观设置':'Appearance'}>
      <header><strong>{zh?'外观':'Appearance'}</strong><button type="button" aria-label={zh?'关闭外观设置':'Close appearance'} onClick={()=>{setOpen(false);trigger.current?.focus();}}>×</button></header>
      <fieldset><legend>{zh?'明暗':'Colour mode'}</legend><div className="appearance-segments">{(['system','light','dark'] as const).map((value,i)=><button type="button" key={value} aria-pressed={theme===value} onClick={()=>onTheme(value)}>{(zh?['跟随系统','浅色','深色']:['System','Light','Dark'])[i]}</button>)}</div></fieldset>
      <fieldset><legend>{zh?'材质':'Material'}</legend><div className="appearance-segments">{(['standard','glass'] as const).map((value,i)=><button type="button" key={value} aria-pressed={material.material===value} onClick={()=>choose({material:value})}>{(zh?['标准','液态玻璃']:['Standard','Liquid Glass'])[i]}</button>)}</div></fieldset>
      <fieldset><legend>{zh?'布局':'Layout'}</legend><div className="appearance-segments">{(['classic','studio'] as const).map((value,i)=><button type="button" key={value} aria-pressed={layout===value} onClick={()=>onLayout(value)}>{(zh?['经典','工作室']:['Classic','Studio'])[i]}</button>)}</div></fieldset>
      <fieldset><legend>{zh?'配色':'Palette'}</legend><div className="appearance-swatches">{(['white','graphite','mist','violet','green'] as const).map((value,i)=><button type="button" key={value} data-palette={value} aria-label={(zh?['纯白','石墨蓝','雾蓝','紫灰','经典绿']:['Pure white','Graphite','Mist','Violet','Green'])[i]} aria-pressed={palette===value} title={(zh?['纯白','石墨蓝','雾蓝','紫灰','经典绿']:['Pure white','Graphite','Mist','Violet','Green'])[i]} onClick={()=>onPalette(value)}><i/>{palette===value&&<span aria-hidden="true">✓</span>}</button>)}</div></fieldset>
      <label className="appearance-reduce"><span>{zh?'减少透明效果':'Reduce transparency'}</span><input type="checkbox" checked={material.transparency==='reduce'} onChange={event=>choose({transparency:event.target.checked?'reduce':'system'})}/></label>
    </section>}
  </div>;
}
