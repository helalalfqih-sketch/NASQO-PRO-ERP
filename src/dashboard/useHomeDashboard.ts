import { useCallback, useEffect, useRef, useState } from 'react';
import { businessToday } from '../utils/businessSetup';
import { fetchHomeDashboard } from '../firebase';
import { readUiState, writeUiState } from '../hybrid/resumeState';
import type { HomeScope, HomeSnapshot } from './model';

export function useHomeDashboard(uid: string, source: string, scope: Partial<HomeScope>, revision: readonly unknown[], cacheContext = '') {
  const query=JSON.stringify(scope), key=JSON.stringify([scope,cacheContext]), identity=`${uid}:owner`;
  const [data,setData]=useState<HomeSnapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[stale,setStale]=useState(false);
  const [tick,setTick]=useState(0); const generation=useRef(0);
  const refresh=useCallback(()=>setTick(t=>t+1),[]);
  useEffect(()=>{
    const id=++generation.current; let alive=true;
    const matches=(v:unknown):v is {key:string;data:HomeSnapshot}=>{
      const c=v as {key?:string;data?:HomeSnapshot}|null;
      return !!c&&c.key===key&&c.data?.version===1&&c.data.principal.id===identity&&c.data.principal.role==='manager'&&c.data.source===source&&c.data.kpis.length===4;
    };
    // Cache is scoped to the authenticated workspace proprietor AND restored source.
    const cached=readUiState<{key:string;data:HomeSnapshot}|null>(identity,'home-summary',null,matches);
    setData(cached?.data??null);setStale(Boolean(cached));setLoading(true);setError('');
    const timer=setTimeout(()=>{
      fetchHomeDashboard(uid,JSON.parse(query)).then(next=>{
        if(!alive||id!==generation.current)return;
        if(next.source!==source || next.principal.id!==identity) throw new Error('تغيّر مصدر البيانات؛ حدّث مساحة العمل.');
        setData(next);setStale(false);
        if(!writeUiState(identity,'home-summary',{key,data:next})) setError('تعذر حفظ نسخة الرئيسية دون اتصال. البيانات المعروضة محدثة.');
      }).catch(e=>{if(alive&&id===generation.current){setError(e instanceof Error?e.message:'تعذر تحديث الرئيسية.');setStale(true);}}).finally(()=>{if(alive&&id===generation.current)setLoading(false);});
    },120);
    return()=>{alive=false;clearTimeout(timer);};
  },[uid,source,key,tick,...revision]);
  useEffect(()=>{
    let lastDay=businessToday(data?.timezone);
    const foreground=()=>{if(!document.hidden)refresh();};
    const interval=setInterval(()=>{const day=businessToday(data?.timezone);if(day!==lastDay){lastDay=day;refresh();}},60_000);
    window.addEventListener('online',refresh);window.addEventListener('focus',foreground);document.addEventListener('visibilitychange',foreground);
    return()=>{clearInterval(interval);window.removeEventListener('online',refresh);window.removeEventListener('focus',foreground);document.removeEventListener('visibilitychange',foreground);};
  },[refresh,data?.timezone]);
  return {data,error,loading,stale,refresh};
}
