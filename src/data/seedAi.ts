import type { AiAgent, AiJob } from '../lib/types';

/* De AI-tjenester, værkstedet kan fordele arbejde imellem.
   canOrchestrate: kan lede de andre (kun Codex og Claude). */
export const seedAiAgents: AiAgent[] = [
  { id: 'ai-kimi', name: 'Kimi', provider: 'Moonshot AI', kind: 'subscription', color: 'indigo', strengths: ['Research', 'Lange dokumenter', 'Dansk tekst'], canOrchestrate: false, active: true },
  { id: 'ai-codex', name: 'Codex', provider: 'OpenAI', kind: 'subscription', color: 'emerald', strengths: ['Kode', 'Refaktorering', 'Tests'], canOrchestrate: true, active: true },
  { id: 'ai-claude', name: 'Claude', provider: 'Anthropic', kind: 'subscription', color: 'amber', strengths: ['Kode', 'Arkitektur', 'Planlægning'], canOrchestrate: true, active: true },
  { id: 'ai-gemini', name: 'Gemini', provider: 'Google', kind: 'subscription', color: 'sky', strengths: ['Multimodal', 'Research', 'Store kontekster'], canOrchestrate: false, active: true },
  { id: 'ai-meshy', name: 'Meshy', provider: 'Meshy', kind: 'api', color: 'teal', strengths: ['3D-modeller', 'Teksturer'], canOrchestrate: false, active: true },
  { id: 'ai-eleven', name: 'ElevenLabs', provider: 'ElevenLabs', kind: 'api', color: 'rose', strengths: ['Stemmer', 'TTS', 'Lyddesign'], canOrchestrate: false, active: true },
  { id: 'ai-heygen', name: 'HeyGen', provider: 'HeyGen', kind: 'api', color: 'violet', strengths: ['Avatar-video', 'Præsentationer'], canOrchestrate: false, active: true },
  { id: 'ai-qwen', name: 'Qwen (lokal)', provider: 'Lokal', kind: 'local', color: 'slate', strengths: ['Privat', 'Offline', 'Hurtig'], canOrchestrate: false, active: true },
  { id: 'ai-deepseek', name: 'DeepSeek Flash', provider: 'DeepSeek', kind: 'api', color: 'cyan', strengths: ['Hurtig kode', 'Billig inference'], canOrchestrate: false, active: true },
  { id: 'ai-grok', name: 'Grok', provider: 'xAI', kind: 'subscription', color: 'orange', strengths: ['Nyheder', 'X-data', 'Brainstorm'], canOrchestrate: false, active: true },
];

const mk = (j: Omit<AiJob, 'createdAt' | 'updatedAt' | 'description' | 'question' | 'answer' | 'result' | 'dependsOn'> & Partial<AiJob>): AiJob => ({
  description: '',
  question: '',
  answer: '',
  result: '',
  dependsOn: [],
  createdAt: '2026-10-10T09:00:00.000Z',
  updatedAt: '2026-10-16T15:30:00.000Z',
  ...j,
});

/* Showcase: ét spilprojekt kørt igennem hele pipelinen */
export const seedAiJobs: AiJob[] = [
  // Koncept
  mk({ id: 'aj-1', projectId: 'p-game', title: 'Spilkoncept: kerne-loop og USP', agentId: 'ai-claude', phase: 'concept', status: 'done',
    description: 'Definér kerne-loop, målgruppe og det unikke ved spillet. Output: konceptdokument på 2 sider.',
    result: 'Kerne-loop: udforsk → saml sjæle → forstærk dragen → åbn nyt område. USP: dragen som emotionel følgesvend.' }),
  mk({ id: 'aj-2', projectId: 'p-game', title: 'Verdensbygning: lore-dokument', agentId: 'ai-kimi', phase: 'concept', status: 'done',
    description: 'Lore for Dragenatten: historie, fraktioner, tidslinje.',
    result: 'Lore-dokument udarbejdet: 3 fraktioner, 200 års tidslinje, 12 siders baggrundsmateriale.' }),
  // Design
  mk({ id: 'aj-3', projectId: 'p-game', title: 'GDD: level-design og progression', agentId: 'ai-claude', phase: 'design', status: 'inprogress',
    description: 'Game design document: banestruktur, sværhedskurve, unlocks. Bygger videre på koncept og lore.',
    dependsOn: ['aj-1', 'aj-2'] }),
  mk({ id: 'aj-4', projectId: 'p-game', title: 'Karakterdesign: hovedperson + drage', agentId: 'ai-gemini', phase: 'design', status: 'review',
    description: 'Visuelt design + referencer. Output: moodboard og beskrivelser klar til 3D.',
    dependsOn: ['aj-1'],
    result: '2 konceptretninger klar til gennemsyn. Dragen i "nordisk mørk fantasy"-stil.' }),
  // Prototype
  mk({ id: 'aj-5', projectId: 'p-game', title: 'Unity-prototype: movement controller', agentId: 'ai-codex', phase: 'prototype', status: 'inprogress',
    description: 'Første spilbar prototype: karakterbevægelse, kamera, grundfysik.',
    dependsOn: ['aj-3'] }),
  mk({ id: 'aj-6', projectId: 'p-game', title: 'Bygbar demo (.exe til playtest)', agentId: 'ai-codex', phase: 'prototype', status: 'queued',
    description: 'Pak prototypen til en bygbar demo, når controlleren er klar.',
    dependsOn: ['aj-5'] }),
  // Produktion
  mk({ id: 'aj-7', projectId: 'p-game', title: '3D-model: drage (rigget)', agentId: 'ai-meshy', phase: 'production', status: 'queued',
    description: 'Generér rigget drage-model + teksturer ud fra karakterdesignet.',
    dependsOn: ['aj-4'] }),
  mk({ id: 'aj-8', projectId: 'p-game', title: 'Stemmer: dialoglinjer på dansk', agentId: 'ai-eleven', phase: 'production', status: 'queued',
    description: 'Tekst-til-tale for alle dialoglinjer (ca. 40 linjer). Afventer endelig manus fra GDD.' }),
  mk({ id: 'aj-9', projectId: 'p-game', title: 'Baggrundsmusik: to stemningsspor', agentId: 'ai-eleven', phase: 'production', status: 'queued',
    description: 'Ét roligt og ét intenst spor til skoven og bosskampen.' }),
  mk({ id: 'aj-10', projectId: 'p-game', title: 'Trailerskript + voiceover', agentId: 'ai-heygen', phase: 'production', status: 'queued',
    description: '30 sek. trailer med avatar-voiceover, klar til SoMe.',
    dependsOn: ['aj-6', 'aj-8'] }),
  mk({ id: 'aj-11', projectId: 'p-game', title: 'Kode-gennemgang: memory leaks', agentId: 'ai-deepseek', phase: 'production', status: 'queued',
    description: 'Billig første gennemgang af prototypens ressourcehåndtering.' }),
  // Test
  mk({ id: 'aj-12', projectId: 'p-game', title: 'Playtest-plan og spørgeskema', agentId: 'ai-kimi', phase: 'testing', status: 'blocked',
    description: 'Lav plan for første playtestrunde: mål, opgaver, spørgeskema.',
    question: 'Hvor mange playtestere skal vi bruge i første runde – og skal de være målgruppen eller “hvem som helst”?',
    dependsOn: ['aj-6'] }),
  mk({ id: 'aj-13', projectId: 'p-game', title: 'Bug-triage: auto-rapporter', agentId: 'ai-grok', phase: 'testing', status: 'queued',
    description: 'Kategorisér playtest-feedback og fejl efter alvor.' }),
  // Polish & release
  mk({ id: 'aj-14', projectId: 'p-game', title: 'Steam-side: beskrivelse + tags', agentId: 'ai-kimi', phase: 'release', status: 'queued',
    description: 'Capsule-tekst, tags og beskrivelse optimeret til Steam.' }),
  mk({ id: 'aj-15', projectId: 'p-game', title: 'Build & release: itch.io', agentId: 'ai-qwen', phase: 'release', status: 'queued',
    description: 'Lokal bygning og upload – kører privat/offline.',
    dependsOn: ['aj-13'] }),
];
