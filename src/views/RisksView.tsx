import { useMemo, useState, type ReactNode } from 'react';
import { Bug, Plus, ShieldAlert, Trash, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useLang, t } from '../lib/i18n';
import { cn, taskRef } from '../lib/utils';
import type { IssueEntry, Risk } from '../lib/types';
import { ViewHeader } from '../components/common';

const PROBS = [5, 4, 3, 2, 1];
const IMPACTS = [1, 2, 3, 4, 5];

const SEVERITY_META: Record<IssueEntry['severity'], { labelKey: string; badge: string }> = {
  low: { labelKey: 'risks.severityLow', badge: 'bg-sky-500/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300' },
  medium: { labelKey: 'risks.severityMedium', badge: 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300' },
  high: { labelKey: 'risks.severityHigh', badge: 'bg-orange-500/10 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300' },
  critical: { labelKey: 'risks.severityCritical', badge: 'bg-rose-500/10 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300' },
};

const RISK_STATUS_META: Record<Risk['status'], { labelKey: string }> = {
  open: { labelKey: 'risks.statusOpen' },
  mitigated: { labelKey: 'risks.statusMitigated' },
  closed: { labelKey: 'risks.statusClosed' },
};

const ISSUE_STATUS_META: Record<IssueEntry['status'], { labelKey: string }> = {
  open: { labelKey: 'risks.issueOpen' },
  inprogress: { labelKey: 'risks.issueInprogress' },
  resolved: { labelKey: 'risks.issueResolved' },
};

function scoreTone(score: number): string {
  if (score < 6) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (score < 12) return 'bg-amber-500/20 text-amber-700 dark:text-amber-300';
  return 'bg-rose-500/25 text-rose-700 dark:text-rose-300';
}

function Section({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass-panel card-hover animate-fade-in rounded-xl p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-500 dark:text-indigo-400">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
          {subtitle && <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      <div className="pt-3">{children}</div>
    </section>
  );
}

const selectCls = 'input w-auto cursor-pointer py-1 text-xs';

export default function RisksView() {
  useLang();
  const risks = useStore((s) => s.risks);
  const issues = useStore((s) => s.issues);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const selectTask = useStore((s) => s.selectTask);
  const addRisk = useStore((s) => s.addRisk);
  const updateRisk = useStore((s) => s.updateRisk);
  const deleteRisk = useStore((s) => s.deleteRisk);
  const addIssue = useStore((s) => s.addIssue);
  const updateIssue = useStore((s) => s.updateIssue);
  const deleteIssue = useStore((s) => s.deleteIssue);

  const [newRiskTitle, setNewRiskTitle] = useState('');
  const [newIssueTitle, setNewIssueTitle] = useState('');

  const targetProjectId = activeProjectId ?? projects[0]?.id ?? null;

  const projectRisks = useMemo(
    () => risks.filter((r) => (activeProjectId ? r.projectId === activeProjectId : true)),
    [risks, activeProjectId],
  );
  const projectIssues = useMemo(
    () => issues.filter((i) => (activeProjectId ? i.projectId === activeProjectId : true)),
    [issues, activeProjectId],
  );

  const openByCell = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of projectRisks) {
      if (r.status !== 'open') continue;
      const key = `${r.probability}-${r.impact}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [projectRisks]);

  const submitRisk = () => {
    if (!targetProjectId || !newRiskTitle.trim()) return;
    addRisk(targetProjectId, newRiskTitle, 3, 3);
    setNewRiskTitle('');
  };

  const submitIssue = () => {
    if (!targetProjectId || !newIssueTitle.trim()) return;
    addIssue(targetProjectId, newIssueTitle, 'medium');
    setNewIssueTitle('');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
        <ViewHeader title={t('risks.title')} subtitle={t('risks.subtitle')} />
        {!activeProjectId && (
          <p className="-mt-2 text-xs text-zinc-400 dark:text-zinc-500">{t('risks.noProject')}</p>
        )}

        {/* Risikomatrise */}
        <Section title={t('risks.matrixTitle')} subtitle={t('risks.matrixSub')} icon={<ShieldAlert className="h-4 w-4" />}>
          <div className="grid items-start gap-5 lg:grid-cols-[auto_1fr]">
            <div className="overflow-x-auto">
              <div className="inline-grid grid-cols-[1.75rem_repeat(5,minmax(2.5rem,1fr))] gap-1">
                <div />
                {IMPACTS.map((i) => (
                  <div
                    key={i}
                    className="pb-1 text-center text-[11px] font-semibold tabular-nums text-zinc-500 dark:text-zinc-400"
                  >
                    {i}
                  </div>
                ))}
                {PROBS.map((p) => (
                  <div key={p} className="contents">
                    <div className="flex items-center justify-center pr-1 text-[11px] font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
                      {p}
                    </div>
                    {IMPACTS.map((i) => {
                      const count = openByCell.get(`${p}-${i}`) ?? 0;
                      return (
                        <div
                          key={i}
                          title={t('risks.cellTitle').replace('{p}', String(p)).replace('{i}', String(i)).replace('{n}', String(count))}
                          className={cn(
                            'grid h-10 cursor-default place-items-center rounded-md text-xs font-semibold tabular-nums transition-transform hover:scale-105',
                            scoreTone(p * i),
                            count === 0 && 'opacity-35',
                          )}
                        >
                          {count > 0 ? count : ''}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3 pl-7 text-[11px] text-zinc-400 dark:text-zinc-500">
                <span className="font-medium">{t('risks.axisProbability')} ↑</span>
                <span className="font-medium">→ {t('risks.axisImpact')}</span>
              </div>
            </div>

            <div className="min-w-0">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {t('risks.risksTitle')} · {projectRisks.length}
              </h3>
              {projectRisks.length === 0 ? (
                <p className="py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">{t('risks.emptyRisks')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        <th className="pb-2 pr-3 font-medium">{t('risks.colTitle')}</th>
                        <th className="pb-2 pr-2 text-center font-medium" title={t('risks.axisProbability')}>
                          {t('risks.colProbability')}
                        </th>
                        <th className="pb-2 pr-2 text-center font-medium" title={t('risks.axisImpact')}>
                          {t('risks.colImpact')}
                        </th>
                        <th className="pb-2 pr-3 text-center font-medium">{t('risks.colScore')}</th>
                        <th className="pb-2 pr-3 font-medium">{t('risks.colMitigation')}</th>
                        <th className="pb-2 pr-2 font-medium">{t('risks.colStatus')}</th>
                        <th className="pb-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {projectRisks.map((r) => (
                        <tr key={r.id} className="border-t border-zinc-100 dark:border-white/[0.06]">
                          <td className="max-w-0 w-1/4 truncate py-2 pr-3 text-zinc-800 dark:text-zinc-100" title={r.title}>
                            {r.title}
                          </td>
                          <td className="py-2 pr-2 text-center">
                            <select
                              value={r.probability}
                              onChange={(e) => updateRisk(r.id, { probability: Number(e.target.value) })}
                              className={selectCls}
                            >
                              {PROBS.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-2 text-center">
                            <select
                              value={r.impact}
                              onChange={(e) => updateRisk(r.id, { impact: Number(e.target.value) })}
                              className={selectCls}
                            >
                              {IMPACTS.map((i) => (
                                <option key={i} value={i}>
                                  {i}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-3 text-center">
                            <span
                              className={cn(
                                'inline-grid h-6 min-w-6 place-items-center rounded-md px-1 text-[11px] font-bold tabular-nums',
                                scoreTone(r.probability * r.impact),
                              )}
                            >
                              {r.probability * r.impact}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <input
                              value={r.mitigation}
                              onChange={(e) => updateRisk(r.id, { mitigation: e.target.value })}
                              placeholder={t('risks.mitigationPlaceholder')}
                              className="input w-full min-w-32 py-1 text-xs"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <select
                              value={r.status}
                              onChange={(e) => updateRisk(r.id, { status: e.target.value as Risk['status'] })}
                              className={selectCls}
                            >
                              {(Object.keys(RISK_STATUS_META) as Risk['status'][]).map((s) => (
                                <option key={s} value={s}>
                                  {t(RISK_STATUS_META[s].labelKey)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 text-right">
                            <button
                              onClick={() => {
                                if (window.confirm(t('risks.confirmDeleteRisk').replace('{title}', r.title))) deleteRisk(r.id);
                              }}
                              title={t('risks.deleteTitle')}
                              className="btn-ghost px-1.5 py-1 text-xs text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                <input
                  value={newRiskTitle}
                  onChange={(e) => setNewRiskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRisk();
                  }}
                  placeholder={t('risks.newRiskPlaceholder')}
                  disabled={!targetProjectId}
                  className="input flex-1 py-1.5 text-xs"
                />
                <button onClick={submitRisk} disabled={!targetProjectId || !newRiskTitle.trim()} className="btn-primary px-2.5 py-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  {t('risks.add')}
                </button>
              </div>
            </div>
          </div>
        </Section>

        {/* Fejl/issue-log */}
        <Section title={t('risks.issuesTitle')} subtitle={`${projectIssues.length}`} icon={<Bug className="h-4 w-4" />}>
          {projectIssues.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">{t('risks.emptyIssues')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    <th className="pb-2 pr-3 font-medium">{t('risks.colTitle')}</th>
                    <th className="pb-2 pr-3 font-medium">{t('risks.colSeverity')}</th>
                    <th className="pb-2 pr-3 font-medium">{t('risks.colStatus')}</th>
                    <th className="pb-2 pr-3 font-medium">{t('risks.colTask')}</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {projectIssues.map((issue) => {
                    const linkedTask = issue.taskId ? tasks.find((task) => task.id === issue.taskId) : null;
                    return (
                      <tr key={issue.id} className="border-t border-zinc-100 dark:border-white/[0.06]">
                        <td className="max-w-0 w-1/2 truncate py-2 pr-3 text-zinc-800 dark:text-zinc-100" title={issue.title}>
                          {issue.title}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-2">
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                SEVERITY_META[issue.severity].badge,
                              )}
                            >
                              {t(SEVERITY_META[issue.severity].labelKey)}
                            </span>
                            <select
                              value={issue.severity}
                              onChange={(e) => updateIssue(issue.id, { severity: e.target.value as IssueEntry['severity'] })}
                              className={selectCls}
                            >
                              {(Object.keys(SEVERITY_META) as IssueEntry['severity'][]).map((s) => (
                                <option key={s} value={s}>
                                  {t(SEVERITY_META[s].labelKey)}
                                </option>
                              ))}
                            </select>
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={issue.status}
                            onChange={(e) => updateIssue(issue.id, { status: e.target.value as IssueEntry['status'] })}
                            className={selectCls}
                          >
                            {(Object.keys(ISSUE_STATUS_META) as IssueEntry['status'][]).map((s) => (
                              <option key={s} value={s}>
                                {t(ISSUE_STATUS_META[s].labelKey)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-3">
                          {linkedTask ? (
                            <button
                              onClick={() => selectTask(linkedTask.id)}
                              title={linkedTask.title}
                              className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-zinc-600 transition-colors hover:bg-indigo-500/10 hover:text-indigo-700 dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:text-indigo-300"
                            >
                              {taskRef(linkedTask, projects)}
                            </button>
                          ) : (
                            <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => {
                              if (window.confirm(t('risks.confirmDeleteIssue').replace('{title}', issue.title))) deleteIssue(issue.id);
                            }}
                            title={t('risks.deleteTitle')}
                            className="btn-ghost px-1.5 py-1 text-xs text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                          >
                            <Trash className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <input
              value={newIssueTitle}
              onChange={(e) => setNewIssueTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitIssue();
              }}
              placeholder={t('risks.newIssuePlaceholder')}
              disabled={!targetProjectId}
              className="input flex-1 py-1.5 text-xs"
            />
            <button onClick={submitIssue} disabled={!targetProjectId || !newIssueTitle.trim()} className="btn-primary px-2.5 py-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              {t('risks.add')}
            </button>
          </div>
          {!targetProjectId && <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">{t('risks.noProjectToAdd')}</p>}
        </Section>
      </div>
    </div>
  );
}
