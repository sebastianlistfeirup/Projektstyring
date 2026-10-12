// Projektskabeloner – opgaver med dage relativt til projektets startdato

export interface TemplateTask {
  title: string;
  daysOffset: number; // startdato relativt til projektstart
  durationDays: number;
  estimate: number | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  assigneeRole: string; // rolle der foreslås som ansvarlig
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  tasks: TemplateTask[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'tpl-web',
    name: 'Hjemmeside-lancering',
    description: 'Fra idé til lanceret hjemmeside – indhold, design, teknik og lancering.',
    tasks: [
      { title: 'Kickoff og mål for hjemmesiden', daysOffset: 0, durationDays: 1, estimate: 2, priority: 'high', assigneeRole: 'Projektleder' },
      { title: 'Indholdsstruktur og sitemap', daysOffset: 1, durationDays: 3, estimate: 3, priority: 'high', assigneeRole: 'Projektleder' },
      { title: 'Wireframes til kernesider', daysOffset: 3, durationDays: 5, estimate: 5, priority: 'medium', assigneeRole: 'Designer' },
      { title: 'Visuelt design (desktop + mobil)', daysOffset: 6, durationDays: 7, estimate: 8, priority: 'high', assigneeRole: 'Designer' },
      { title: 'Tekster til alle sider', daysOffset: 8, durationDays: 7, estimate: 5, priority: 'medium', assigneeRole: 'Projektleder' },
      { title: 'Opbygning i CMS', daysOffset: 10, durationDays: 8, estimate: 8, priority: 'high', assigneeRole: 'Udvikler' },
      { title: 'SEO-opsætning og metadata', daysOffset: 15, durationDays: 3, estimate: 3, priority: 'medium', assigneeRole: 'Udvikler' },
      { title: 'Test på tværs af browsere og enheder', daysOffset: 17, durationDays: 3, estimate: 3, priority: 'high', assigneeRole: 'QA' },
      { title: 'Redirect-plan og go-live', daysOffset: 19, durationDays: 2, estimate: 2, priority: 'urgent', assigneeRole: 'Udvikler' },
      { title: 'Efterevaluering og lancering på SoMe', daysOffset: 21, durationDays: 2, estimate: 2, priority: 'low', assigneeRole: 'Projektleder' },
    ],
  },
  {
    id: 'tpl-app',
    name: 'App-sprint (2 uger)',
    description: 'Et klassisk udviklingssprint med planlægning, udvikling, test og demo.',
    tasks: [
      { title: 'Sprint-planlægning og mål', daysOffset: 0, durationDays: 1, estimate: 2, priority: 'high', assigneeRole: 'Projektleder' },
      { title: 'Opdeling i opgaver og estimater', daysOffset: 0, durationDays: 1, estimate: 2, priority: 'high', assigneeRole: 'Udvikler' },
      { title: 'Udvikling – kerneopgaver', daysOffset: 1, durationDays: 7, estimate: 13, priority: 'medium', assigneeRole: 'Udvikler' },
      { title: 'Designafklaring løbende', daysOffset: 2, durationDays: 6, estimate: 5, priority: 'medium', assigneeRole: 'Designer' },
      { title: 'Test af nye funktioner', daysOffset: 8, durationDays: 3, estimate: 5, priority: 'high', assigneeRole: 'QA' },
      { title: 'Rettelser og polering', daysOffset: 10, durationDays: 2, estimate: 3, priority: 'high', assigneeRole: 'Udvikler' },
      { title: 'Sprint-demo og retrospektiv', daysOffset: 13, durationDays: 1, estimate: 2, priority: 'medium', assigneeRole: 'Projektleder' },
    ],
  },
  {
    id: 'tpl-onboarding',
    name: 'Onboarding af ny medarbejder',
    description: 'Tryg start på jobbet – it, introduktioner og første opgaver.',
    tasks: [
      { title: 'Opret brugere og adgange (it)', daysOffset: -3, durationDays: 1, estimate: 2, priority: 'urgent', assigneeRole: 'Udvikler' },
      { title: 'Forbered udstyr og arbejdsplads', daysOffset: -2, durationDays: 1, estimate: 1, priority: 'high', assigneeRole: 'Projektleder' },
      { title: 'Introduktionsmøde og rundvisning', daysOffset: 0, durationDays: 1, estimate: 1, priority: 'high', assigneeRole: 'Projektleder' },
      { title: 'Gennemgang af sikkerhed og politikker', daysOffset: 0, durationDays: 1, estimate: 1, priority: 'medium', assigneeRole: 'Projektleder' },
      { title: 'Mød teamet – kaffe-chat med alle', daysOffset: 1, durationDays: 3, estimate: 1, priority: 'low', assigneeRole: 'Projektleder' },
      { title: 'Introduktion til værktøjer og systemer', daysOffset: 2, durationDays: 2, estimate: 2, priority: 'medium', assigneeRole: 'Udvikler' },
      { title: 'Første rigtige opgave med makker', daysOffset: 5, durationDays: 5, estimate: 5, priority: 'medium', assigneeRole: 'Designer' },
      { title: 'Opfølgning efter 30 dage', daysOffset: 30, durationDays: 1, estimate: 1, priority: 'medium', assigneeRole: 'Projektleder' },
    ],
  },
];
