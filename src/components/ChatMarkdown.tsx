import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Raw HTML is deliberately not enabled: files and model output are content.
export default function ChatMarkdown({ text }: { text: string }) {
  return <div className="break-words space-y-2">
    <Markdown remarkPlugins={[remarkGfm]} components={{
      h1: ({ children }) => <h2 className="text-lg font-semibold mt-4">{children}</h2>,
      h2: ({ children }) => <h3 className="text-base font-semibold mt-3">{children}</h3>,
      h3: ({ children }) => <h4 className="font-semibold mt-3">{children}</h4>,
      p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
      ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
      blockquote: ({ children }) => <blockquote className="border-l-2 border-indigo-400 pl-3 opacity-80">{children}</blockquote>,
      pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-xl bg-black/40 p-3 text-xs font-mono">{children}</pre>,
      code: ({ children }) => <code className="rounded bg-black/10 px-1 font-mono text-[0.95em]">{children}</code>,
      table: ({ children }) => <div className="overflow-x-auto my-3"><table className="text-xs border-collapse w-full">{children}</table></div>,
      th: ({ children }) => <th className="border border-zinc-300 dark:border-white/[0.15] px-3 py-2 text-left font-semibold">{children}</th>,
      td: ({ children }) => <td className="border border-zinc-300 dark:border-white/[0.15] px-3 py-2 align-top">{children}</td>,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline">{children}</a>,
      img: ({ alt, src }) => <a href={src} target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline">{alt || 'Åbn billede'}</a>,
    }}>{text}</Markdown>
  </div>;
}
