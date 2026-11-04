import { useCallback, useRef, useState } from 'react';
import type { AiAttachment } from './types';
import type { PipelineTemplate } from './aiApi';

type Draft = { text: string; attachments: AiAttachment[]; plan: PipelineTemplate['jobs'] | null };
type Drafts = Record<string, Draft>;
const key = 'orbit-chat-drafts-v1';
function load(): Drafts {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}');
    return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, Draft] => {
      const draft = entry[1] as Draft;
      return Boolean(draft && typeof draft.text === 'string' && Array.isArray(draft.attachments) && draft.attachments.length <= 10);
    }));
  } catch { return {}; }
}

/** Unsent input belongs to its conversation, including uploads completing after
 * navigation. Persist metadata only: image bytes and extracted books stay out. */
export function useChatDraft(chatId: string | null) {
  const [drafts, setDrafts] = useState<Drafts>(load);
  const current = useRef(drafts);
  const [persistenceIssue, setPersistenceIssue] = useState('');
  const id = chatId ?? 'unassigned';
  const update = useCallback((change: (draft: Draft) => Draft) => {
    const next = { ...current.current, [id]: change(current.current[id] ?? { text: '', attachments: [], plan: null }) };
    current.current = next; setDrafts(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(next).map(([id, draft]) => [id, { ...draft, attachments: draft.attachments.map(({ dataUrl: _data, extractedText: _text, ...metadata }) => metadata) }]))));
      setPersistenceIssue('');
    } catch { setPersistenceIssue('Browseren kunne ikke gemme kladden til genindlæsning. Kopiér vigtig tekst, før du lukker fanen.'); }
  }, [id]);
  const setText = useCallback((text: string | ((previous: string) => string)) => update(draft => ({ ...draft, text: typeof text === 'function' ? text(draft.text) : text })), [update]);
  const setPending = useCallback((change: AiAttachment[] | ((previous: AiAttachment[]) => AiAttachment[])) => update(draft => ({ ...draft, attachments: typeof change === 'function' ? change(draft.attachments) : change })), [update]);
  const setPlanDraft = useCallback((plan: Draft['plan'] | ((previous: Draft['plan']) => Draft['plan'])) => update(draft => ({ ...draft, plan: typeof plan === 'function' ? plan(draft.plan) : plan })), [update]);
  const getPending = useCallback(() => current.current[id]?.attachments ?? [], [id]);
  const draft = drafts[id];
  return { text: draft?.text ?? '', pending: draft?.attachments ?? [], planDraft: draft?.plan ?? null, setText, setPending, setPlanDraft, getPending, persistenceIssue };
}
