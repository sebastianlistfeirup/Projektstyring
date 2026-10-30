import { serviceName, type SwarmJob } from '../lib/swarm';
import type { AiServiceInfo } from '../lib/aiApi';

export default function JobReview({ job, services = null }: { job: SwarmJob; services?: Record<string, AiServiceInfo> | null }) {
  const review = job.review;
  if (!review) return null;
  return <details className="text-xs">
    <summary className="cursor-pointer font-medium">Uafhængigt modelreview · {review.score}/10 · {review.status === 'passed' ? 'Review accepteret' : 'Kræver rettelse'}</summary>
    <div className="mt-2 space-y-2">
      <p>{review.note}</p>
      <p className="opacity-60">{serviceName(services, review.serviceId)} · minimum {review.minimumScore}/10 · commit <span className="font-mono break-all">{review.commit}</span></p>
      <p className="opacity-60">Reviewer angiver at have undersøgt: {review.examinedFiles.join(', ') || 'Ingen filer'}</p>
      {review.findings.map((finding, i) => <p key={i}><b>{finding.severity} · {finding.file}</b><br />{finding.message}</p>)}
      <p className="opacity-50">Modelreview erstatter ikke faktiske kontroller eller din gennemgang.</p>
    </div>
  </details>;
}
