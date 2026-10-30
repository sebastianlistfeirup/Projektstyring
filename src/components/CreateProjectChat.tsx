import { useState } from 'react';
import { useStore } from '../store/useStore';

export default function CreateProjectChat({ onCreate }: { onCreate: (projectId: string, chatId: string) => void }) {
  const [name, setName] = useState('');
  return <details className="text-xs border border-current/10 rounded-lg p-2"><summary className="cursor-pointer opacity-70">Nyt projekt</summary><form className="mt-2 space-y-2" onSubmit={e => {
    e.preventDefault(); if (!name.trim()) return;
    const store = useStore.getState(), project = store.addProject(name.trim()), chat = store.addAiChat({ projectId: project.id, title: 'Ny samtale' });
    setName(''); onCreate(project.id, chat.id);
  }}><label className="block">Projektnavn<input className="input w-full mt-1" value={name} onChange={e => setName(e.target.value)} placeholder="Fx Realmread" /></label><button className="btn-primary text-xs" disabled={!name.trim()}>Opret og åbn samtale</button></form></details>;
}
