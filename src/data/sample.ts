import { createDefaultSettings, type CanvasDoc, type Card, type Connection, type Group, type Page, type Position } from '@/types'

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`
}

const equationImage = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 96">
  <rect width="320" height="96" rx="10" fill="#FFFBEB"/>
  <text x="160" y="42" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="19" font-weight="700" fill="#92400E">6CO&#8322; + 6H&#8322;O</text>
  <text x="160" y="70" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="19" font-weight="700" fill="#B45309">&#8594; C&#8326;H&#8321;&#8322;O&#8326; + 6O&#8322;</text>
  <line x1="24" y1="48" x2="296" y2="48" stroke="#FDE68A" stroke-width="2" stroke-dasharray="4 6"/>
</svg>
`)

const chloroplastImage = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 150">
  <rect width="320" height="150" fill="#F0FDF4"/>
  <rect x="34" y="38" width="252" height="76" rx="38" fill="#BBF7D0" stroke="#22C55E" stroke-width="3"/>
  <g fill="#16A34A">
    <rect x="72" y="58" width="12" height="36" rx="6"/>
    <rect x="72" y="66" width="26" height="9" rx="4"/>
    <rect x="72" y="79" width="26" height="9" rx="4"/>
    <rect x="150" y="58" width="12" height="36" rx="6"/>
    <rect x="146" y="66" width="26" height="9" rx="4"/>
    <rect x="146" y="79" width="26" height="9" rx="4"/>
    <rect x="228" y="58" width="12" height="36" rx="6"/>
    <rect x="224" y="66" width="26" height="9" rx="4"/>
    <rect x="224" y="79" width="26" height="9" rx="4"/>
  </g>
  <path d="M46 76 C34 60 58 48 70 58" fill="none" stroke="#15803D" stroke-width="3" stroke-linecap="round"/>
  <path d="M274 76 C286 60 262 48 250 58" fill="none" stroke="#15803D" stroke-width="3" stroke-linecap="round"/>
  <text x="160" y="134" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="14" fill="#166534">grana stacks joined by stroma lamellae</text>
</svg>
`)

const T = '2026-09-26T00:00:00.000Z'

const cards: Card[] = [
  {
    id: 'card_01',
    title: 'Photosynthesis',
    content:
      'The process plants use to convert **light energy** into chemical energy stored in glucose.\n\n' +
      '- Input: carbon dioxide + water + light\n' +
      '- Output: glucose + oxygen\n\n' +
      '![Balanced equation for photosynthesis](' +
      equationImage +
      ')',
    image: { src: equationImage, alt: 'Balanced equation for photosynthesis' },
    position: { x: 470, y: 40, width: 320, height: 270, zIndex: 1 },
    style: {
      backgroundColor: '#FFF8CC',
      accentColor: '#F59E0B',
      textColor: '#222222',
      borderColor: '#FDE68A',
      borderWidth: 1,
      borderRadius: 12,
      shadow: true,
    },
    tags: ['biology', 'unit-3'],
    collapsed: false,
    parentId: null,
    checklist: [],
    createdAt: T,
    updatedAt: T,
  },
  {
    id: 'card_02',
    title: 'Chloroplast Structure',
    content:
      'Double-membrane organelle, only in plants & algae.\n\n' +
      '- **Grana** — stacked thylakoids\n' +
      '- **Stroma** — enzyme-rich fluid\n\n' +
      '![Simplified chloroplast diagram](' +
      chloroplastImage +
      ')',
    image: { src: chloroplastImage, alt: 'Simplified chloroplast diagram' },
    position: { x: 60, y: 400, width: 300, height: 250, zIndex: 2 },
    style: {
      backgroundColor: '#DCFCE7',
      accentColor: '#22C55E',
      textColor: '#052E16',
      borderColor: '#BBF7D0',
      borderWidth: 1,
      borderRadius: 12,
      shadow: true,
    },
    tags: ['biology', 'structure'],
    collapsed: false,
    parentId: 'card_01',
    checklist: [],
    createdAt: T,
    updatedAt: T,
  },
  {
    id: 'card_03',
    title: 'Light Reactions',
    content:
      'Happen in the **thylakoid membrane**. Light energy is converted to ATP and NADPH.\n\n' +
      '> Exam tip: ATP and NADPH are the *currency* passed to the Calvin cycle.',
    image: { src: null, alt: '' },
    position: { x: 440, y: 400, width: 290, height: 270, zIndex: 3 },
    style: {
      backgroundColor: '#E0F2FE',
      accentColor: '#0EA5E9',
      textColor: '#0C4A6E',
      borderColor: '#BAE6FD',
      borderWidth: 1,
      borderRadius: 12,
      shadow: true,
    },
    tags: ['biology', 'stage-1'],
    collapsed: false,
    parentId: 'card_01',
    checklist: [
      { id: 'item_01', text: 'PSII absorbs photons', done: true },
      { id: 'item_02', text: 'Water split (photolysis)', done: true },
      { id: 'item_03', text: 'Electron transport chain', done: false },
      { id: 'item_04', text: 'ATP + NADPH produced', done: false },
    ],
    createdAt: T,
    updatedAt: T,
  },
  {
    id: 'card_04',
    title: 'Calvin Cycle',
    content: 'Happens in the **stroma**. Fixes CO₂ into sugar using the ATP and NADPH from light reactions.',
    image: { src: null, alt: '' },
    position: { x: 820, y: 400, width: 290, height: 270, zIndex: 4 },
    style: {
      backgroundColor: '#EDE9FE',
      accentColor: '#8B5CF6',
      textColor: '#3B0764',
      borderColor: '#DDD6FE',
      borderWidth: 1,
      borderRadius: 12,
      shadow: true,
    },
    tags: ['biology', 'stage-2'],
    collapsed: false,
    parentId: 'card_01',
    checklist: [
      { id: 'item_05', text: 'CO₂ fixation by RuBisCO', done: false },
      { id: 'item_06', text: 'G3P sugar generated', done: false },
      { id: 'item_07', text: 'RuBP regenerated', done: false },
    ],
    createdAt: T,
    updatedAt: T,
  },
  {
    id: 'card_05',
    title: 'Limiting Factors',
    content: 'Rate is capped by whichever resource runs out first. Watch for the classic plateau graph.',
    image: { src: null, alt: '' },
    position: { x: 1200, y: 60, width: 290, height: 250, zIndex: 5 },
    style: {
      backgroundColor: '#FFE4E6',
      accentColor: '#EF4444',
      textColor: '#4C0519',
      borderColor: '#FECDD3',
      borderWidth: 1,
      borderRadius: 12,
      shadow: true,
    },
    tags: ['biology', 'exam-tip'],
    collapsed: false,
    parentId: null,
    checklist: [
      { id: 'item_08', text: 'Light intensity', done: false },
      { id: 'item_09', text: 'CO₂ concentration', done: false },
      { id: 'item_10', text: 'Temperature', done: false },
    ],
    createdAt: T,
    updatedAt: T,
  },
]

const connections: Connection[] = [
  {
    id: 'connection_01',
    source: { kind: 'card', id: 'card_01' },
    target: { kind: 'card', id: 'card_02' },
    sourceAnchor: 'left',
    targetAnchor: 'right',
    label: 'happens inside',
    relationshipType: 'part of',
    style: {
      color: '#22C55E',
      width: 2,
      lineStyle: 'solid',
      routing: 'curved',
      arrowStart: 'none',
      arrowEnd: 'triangle',
      animated: false,
    },
  },
  {
    id: 'connection_02',
    source: { kind: 'card', id: 'card_02' },
    target: { kind: 'card', id: 'card_03' },
    sourceAnchor: 'right',
    targetAnchor: 'left',
    label: 'captures light',
    relationshipType: 'supports',
    style: {
      color: '#6366F1',
      width: 2,
      lineStyle: 'dashed',
      routing: 'stepped',
      arrowStart: 'none',
      arrowEnd: 'arrow',
      animated: false,
    },
  },
  {
    id: 'connection_03',
    source: { kind: 'card', id: 'card_03' },
    target: { kind: 'card', id: 'card_04' },
    sourceAnchor: 'right',
    targetAnchor: 'left',
    label: 'supplies ATP + NADPH',
    relationshipType: 'supports',
    style: {
      color: '#0EA5E9',
      width: 3,
      lineStyle: 'solid',
      routing: 'curved',
      arrowStart: 'none',
      arrowEnd: 'triangle',
      animated: true,
    },
  },
  {
    id: 'connection_04',
    source: { kind: 'card', id: 'card_01' },
    target: { kind: 'card', id: 'card_05' },
    sourceAnchor: 'right',
    targetAnchor: 'left',
    label: 'rate is set by',
    relationshipType: 'depends on',
    style: {
      color: '#EF4444',
      width: 2,
      lineStyle: 'dotted',
      routing: 'straight',
      arrowStart: 'diamond',
      arrowEnd: 'circle',
      animated: false,
    },
  },
  {
    id: 'connection_05',
    source: { kind: 'card', id: 'card_05' },
    target: { kind: 'card', id: 'card_04' },
    sourceAnchor: 'bottom',
    targetAnchor: 'top',
    label: 'CO₂ supply',
    relationshipType: 'example of',
    style: {
      color: '#8B5CF6',
      width: 2,
      lineStyle: 'solid',
      routing: 'stepped',
      arrowStart: 'none',
      arrowEnd: 'diamond',
      animated: false,
    },
  },
  {
    id: 'connection_06',
    source: { kind: 'group', id: 'group_01' },
    target: { kind: 'card', id: 'card_04' },
    sourceAnchor: 'right',
    targetAnchor: 'left',
    label: 'feeds into',
    relationshipType: 'leads to',
    style: {
      color: '#0EA5E9',
      width: 2,
      lineStyle: 'solid',
      routing: 'curved',
      arrowStart: 'none',
      arrowEnd: 'arrow',
      animated: false,
    },
  },
]

const respirationCards: Card[] = [
  {
    id: 'card_10',
    title: 'Cell Respiration',
    content: 'Breaks down glucose to release ATP. Aerobic = 30–32 ATP per glucose.',
    image: { src: null, alt: '' },
    position: { x: 120, y: 120, width: 300, height: 220, zIndex: 1 },
    style: {
      backgroundColor: '#FFE4E6',
      accentColor: '#EF4444',
      textColor: '#4C0519',
      borderColor: '#FECDD3',
      borderWidth: 1,
      borderRadius: 12,
      shadow: true,
    },
    tags: ['biology', 'unit-3'],
    collapsed: false,
    parentId: null,
    checklist: [],
    createdAt: T,
    updatedAt: T,
  },
  {
    id: 'card_11',
    title: 'Mitochondrion',
    content: 'Site of the Krebs cycle and the electron transport chain.',
    image: { src: null, alt: '' },
    position: { x: 520, y: 180, width: 290, height: 210, zIndex: 2 },
    style: {
      backgroundColor: '#FFEDD5',
      accentColor: '#F97316',
      textColor: '#431407',
      borderColor: '#FED7AA',
      borderWidth: 1,
      borderRadius: 12,
      shadow: true,
    },
    tags: ['biology', 'structure'],
    collapsed: false,
    parentId: 'card_10',
    checklist: [],
    createdAt: T,
    updatedAt: T,
  },
]

const respirationConnections: Connection[] = [
  {
    id: 'connection_10',
    source: { kind: 'card', id: 'card_10' },
    target: { kind: 'card', id: 'card_11' },
    sourceAnchor: 'right',
    targetAnchor: 'left',
    label: 'occurs in',
    relationshipType: 'part of',
    style: {
      color: '#F97316',
      width: 2,
      lineStyle: 'solid',
      routing: 'curved',
      arrowStart: 'none',
      arrowEnd: 'arrow',
      animated: false,
    },
  },
]

const groups: Group[] = [
  {
    id: 'group_01',
    title: 'Light-dependent stage',
    position: { x: 380, y: 360, width: 780, height: 340, zIndex: 0 },
    color: '#0EA5E9',
    memberCardIds: ['card_02', 'card_03'],
    memberGroupIds: [],
    createdAt: T,
    updatedAt: T,
  },
]

const pages: Page[] = [
  {
    id: 'page_01',
    title: 'Photosynthesis',
    position: { x: 0, y: 0, width: 1920, height: 1080, zIndex: 0 } satisfies Position,
    viewport: { x: 40, y: 20, zoom: 0.9 },
    cards,
    groups,
    connections,
    createdAt: T,
    updatedAt: T,
  },
  {
    id: 'page_02',
    title: 'Cell Respiration',
    position: { x: 0, y: 0, width: 1920, height: 1080, zIndex: 0 } satisfies Position,
    viewport: { x: 0, y: 0, zoom: 1 },
    cards: respirationCards,
    groups: [],
    connections: respirationConnections,
    createdAt: T,
    updatedAt: T,
  },
]

export function createSampleDoc(): CanvasDoc {
  return {
    version: 1,
    pages,
    settings: createDefaultSettings(),
  }
}
