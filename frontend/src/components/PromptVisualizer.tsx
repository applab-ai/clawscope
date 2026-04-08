import React, { useState } from 'react';
import {
  Card,
  Title,
  Text,
  Stack,
  Group,
  Badge,
  Select,
  Textarea,
  Button,
  Alert,
  Loader,
  Center,
  Collapse,
  Paper,
  Table,
  Progress,
  SimpleGrid,
  ThemeIcon,
  Divider,
} from '@mantine/core';
import {
  IconFiles,
  IconBrain,
  IconSearch,
  IconStack2,
  IconFolderOpen,
  IconLayersIntersect,
  IconCurrencyDollar,
  IconPlayerPlay,
  IconChevronDown,
  IconChevronRight,
  IconCheck,
  IconAlertTriangle,
  IconX,
  IconSparkles,
  IconArrowDown,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

/* ---- types ---- */
interface BootItem { name: string; found: boolean; chars: number; tokens: number; }
interface SkillItem { name: string; description: string; location: string; status: string; source: string; }
interface MatchItem { name: string; score: number; desc_score: number; name_score: number; matched: boolean; skill_md_tokens: number; }
interface RuntimeItem { id: string; label: string; sublabel: string; chars: number; tokens: number; cached: boolean; }
interface ContextItem { name: string; chars: number; tokens: number; soul: boolean; note: string; }
interface BoundaryItem { section: string; chars: number; tokens: number; side: 'cached' | 'dynamic' | 'boundary'; }
interface CostItem { label: string; tokens: number; rate: number; cost: number; }

interface VisualizerStep {
  id: string;
  label: string;
  icon: string;
  status: 'success' | 'warning' | 'error';
  duration_ms: number;
  items: (BootItem | SkillItem | MatchItem | RuntimeItem | ContextItem | BoundaryItem | CostItem)[];
  total_tokens: number;
  total_chars: number;
  cached: boolean;
  detail: string;
  // optional extras
  cost?: {
    cache_read_cost: number; input_cost: number; output_cost: number; total_cost: number;
    nocache_total: number; savings: number; savings_pct: number;
    model_id: string; prices: { input: number; cache_read: number; output: number };
    output_tokens_est: number;
  };
  cached_tokens?: number;
  dynamic_tokens?: number;
  soul_detected?: boolean;
  matched_skill?: string | null;
}

interface VisualizerResult {
  steps: VisualizerStep[];
  total_tokens: number;
  cached_tokens: number;
  uncached_tokens: number;
  cost: { total_cost: number; savings: number; savings_pct: number; model_id: string; };
  assembled_prompt_preview: string;
  matched_skill: string | null;
  skill_load_tokens: number;
}

/* ---- helpers ---- */
const fmtTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();
const fmtCost = (usd: number) => usd < 0.001 ? `$${usd.toFixed(6)}` : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(4)}`;

const STEP_ICONS: Record<string, React.FC<{ size?: number }>> = {
  files: IconFiles,
  skills: IconBrain,
  match: IconSearch,
  sections: IconStack2,
  context: IconFolderOpen,
  cache: IconLayersIntersect,
  cost: IconCurrencyDollar,
};

const STATUS_COLORS: Record<string, string> = {
  success: 'teal',
  warning: 'yellow',
  error: 'red',
};

const STATUS_ICONS: Record<string, React.FC<{ size?: number }>> = {
  success: IconCheck,
  warning: IconAlertTriangle,
  error: IconX,
};

/* ---- StepNode component ---- */
function StepNode({ step, index }: { step: VisualizerStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = STEP_ICONS[step.icon] || IconFiles;
  const StatusIcon = STATUS_ICONS[step.status] || IconCheck;
  const color = STATUS_COLORS[step.status] || 'teal';

  return (
    <div style={{ position: 'relative' }}>
      {/* Connector line from above */}
      {index > 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingTop: 4, paddingBottom: 4,
        }}>
          <div style={{ width: 2, height: 24, background: 'var(--mantine-color-gray-3)' }} />
          <IconArrowDown size={16} color="var(--mantine-color-gray-5)" />
          <div style={{ width: 2, height: 8, background: 'var(--mantine-color-gray-3)' }} />
        </div>
      )}

      <Card
        withBorder
        radius="md"
        style={{
          borderLeft: `4px solid var(--mantine-color-${color}-6)`,
          cursor: 'pointer',
          transition: 'box-shadow 0.15s',
        }}
        onClick={() => setExpanded(!expanded)}
        shadow={expanded ? 'md' : 'xs'}
      >
        {/* Header row */}
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <ThemeIcon size={36} radius="md" color={color} variant="light">
              <Icon size={20} />
            </ThemeIcon>
            <Stack gap={1} style={{ minWidth: 0 }}>
              <Group gap="xs" wrap="nowrap">
                <Text fw={600} size="sm" style={{ whiteSpace: 'nowrap' }}>{step.label}</Text>
                <Badge size="xs" color={color} leftSection={<StatusIcon size={10} />}>
                  {step.status}
                </Badge>
                {step.cached && (
                  <Badge size="xs" color="green" variant="outline">cached</Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed" lineClamp={1}>{step.detail}</Text>
            </Stack>
          </Group>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {step.total_tokens > 0 && (
              <Badge color="blue" variant="light" size="sm">
                {fmtTokens(step.total_tokens)} tok
              </Badge>
            )}
            {step.duration_ms > 0 && (
              <Badge color="gray" variant="outline" size="sm">
                {step.duration_ms}ms
              </Badge>
            )}
            {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </Group>
        </Group>

        {/* Detail panel */}
        <Collapse expanded={expanded}>
          <div style={{ marginTop: 12 }}>
            <Divider mb="sm" />
            <StepDetail step={step} />
          </div>
        </Collapse>
      </Card>
    </div>
  );
}

/* ---- Detail renderers per step type ---- */
function StepDetail({ step }: { step: VisualizerStep }) {
  const { t } = useTranslation();
  switch (step.id) {
    case 'bootstrap':
      return <BootstrapDetail items={step.items as BootItem[]} />;
    case 'skills':
      return <SkillsDetail items={step.items as SkillItem[]} />;
    case 'skill_match':
      return <MatchDetail items={step.items as MatchItem[]} matched={step.matched_skill} />;
    case 'runtime':
      return <RuntimeDetail items={step.items as RuntimeItem[]} />;
    case 'context_files':
      return <ContextDetail items={step.items as ContextItem[]} soul={step.soul_detected} />;
    case 'cache_boundary':
      return <BoundaryDetail items={step.items as BoundaryItem[]} cached={step.cached_tokens} dynamic={step.dynamic_tokens} />;
    case 'cost':
      return <CostDetail items={step.items as CostItem[]} costMeta={step.cost} />;
    default:
      return <Text size="sm" c="dimmed">{t('visualizer.noDetails', 'No details available.')}</Text>;
  }
}

function BootstrapDetail({ items }: { items: BootItem[] }) {
  return (
    <Table withTableBorder withColumnBorders fz="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Datei</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th ta="right">Chars</Table.Th>
          <Table.Th ta="right">Tokens</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {items.map(item => (
          <Table.Tr key={item.name}>
            <Table.Td fw={500}>{item.name}</Table.Td>
            <Table.Td>
              <Badge size="xs" color={item.found ? 'teal' : 'gray'}>
                {item.found ? '✓ gefunden' : '— fehlt'}
              </Badge>
            </Table.Td>
            <Table.Td ta="right">{item.chars.toLocaleString()}</Table.Td>
            <Table.Td ta="right" c={item.tokens > 0 ? 'blue' : 'dimmed'}>{item.tokens.toLocaleString()}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function SkillsDetail({ items }: { items: SkillItem[] }) {
  return (
    <Stack gap="xs">
      {items.slice(0, 20).map(sk => (
        <Paper key={sk.name} withBorder p="xs" radius="sm">
          <Group gap="xs" wrap="nowrap">
            <Badge size="xs" color={sk.source === 'user' ? 'grape' : sk.source === 'workspace' ? 'orange' : 'blue'}>
              {sk.source}
            </Badge>
            <Text size="xs" fw={600}>{sk.name}</Text>
          </Group>
          <Text size="xs" c="dimmed" mt={2}>{sk.description}</Text>
          {sk.location && (
            <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace', fontSize: 10 }} mt={2}>{sk.location}</Text>
          )}
        </Paper>
      ))}
      {items.length > 20 && (
        <Text size="xs" c="dimmed">... und {items.length - 20} weitere Skills</Text>
      )}
    </Stack>
  );
}

function MatchDetail({ items, matched }: { items: MatchItem[]; matched?: string | null }) {
  const { t } = useTranslation();
  return (
    <Stack gap="sm">
      {matched && (
        <Alert color="teal" icon={<IconSparkles size={16} />} title={t('visualizer.skillLoaded', { skill: matched })}>
          {t('visualizer.skillLoadedDesc')}
        </Alert>
      )}
      {!matched && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title={t('visualizer.noSkillMatch')}>
          {t('visualizer.noSkillMatchDesc')}
        </Alert>
      )}
      <Table withTableBorder withColumnBorders fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Skill</Table.Th>
            <Table.Th ta="right">{t('visualizer.totalScore')}</Table.Th>
            <Table.Th ta="right">Desc-Jaccard</Table.Th>
            <Table.Th ta="right">Name-Score</Table.Th>
            <Table.Th ta="right">SKILL.md</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map(m => (
            <Table.Tr key={m.name} style={m.matched ? { background: 'var(--mantine-color-teal-9)', opacity: 0.9 } : {}}>
              <Table.Td fw={m.matched ? 700 : 400}>
                {m.name} {m.matched && '✓'}
              </Table.Td>
              <Table.Td ta="right">
                <Badge size="xs" color={m.score > 0.04 ? 'teal' : 'gray'}>{m.score.toFixed(4)}</Badge>
              </Table.Td>
              <Table.Td ta="right">{m.desc_score.toFixed(4)}</Table.Td>
              <Table.Td ta="right">{m.name_score.toFixed(4)}</Table.Td>
              <Table.Td ta="right">{m.skill_md_tokens > 0 ? `${fmtTokens(m.skill_md_tokens)} tok` : '—'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function RuntimeDetail({ items }: { items: RuntimeItem[] }) {
  return (
    <Table withTableBorder withColumnBorders fz="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Section</Table.Th>
          <Table.Th>Inhalt</Table.Th>
          <Table.Th ta="right">Tokens</Table.Th>
          <Table.Th ta="center">Cache</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {items.map(s => (
          <Table.Tr key={s.id}>
            <Table.Td fw={500}>{s.label}</Table.Td>
            <Table.Td c="dimmed">{s.sublabel}</Table.Td>
            <Table.Td ta="right">{s.tokens.toLocaleString()}</Table.Td>
            <Table.Td ta="center">
              <Badge size="xs" color={s.cached ? 'green' : 'orange'}>
                {s.cached ? 'cached' : 'dynamic'}
              </Badge>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function ContextDetail({ items, soul }: { items: ContextItem[]; soul?: boolean }) {
  return (
    <Stack gap="sm">
      {soul && (
        <Alert color="violet" icon={<IconSparkles size={16} />} title="SOUL.md erkannt">
          Extra Persona-Direktive wird aktiviert: "If SOUL.md is present, embody its persona..."
        </Alert>
      )}
      <Table withTableBorder withColumnBorders fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Datei</Table.Th>
            <Table.Th ta="right">Chars</Table.Th>
            <Table.Th ta="right">Tokens</Table.Th>
            <Table.Th>Notiz</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map(item => (
            <Table.Tr key={item.name} style={item.soul ? { background: 'var(--mantine-color-violet-9)', opacity: 0.9 } : {}}>
              <Table.Td fw={item.soul ? 700 : 400}>{item.name}</Table.Td>
              <Table.Td ta="right">{item.chars.toLocaleString()}</Table.Td>
              <Table.Td ta="right" c="blue">{item.tokens.toLocaleString()}</Table.Td>
              <Table.Td c="dimmed" fz={10}>{item.note}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function BoundaryDetail({ items, cached, dynamic }: { items: BoundaryItem[]; cached?: number; dynamic?: number }) {
  return (
    <Stack gap="sm">
      <SimpleGrid cols={2}>
        <Paper withBorder p="sm" radius="md" style={{ borderColor: 'var(--mantine-color-green-4)' }}>
          <Text size="xs" c="dimmed">Cached (günstig)</Text>
          <Text fw={700} c="green">{fmtTokens(cached || 0)} tokens</Text>
          <Text size="xs" c="dimmed">× cache_read rate</Text>
        </Paper>
        <Paper withBorder p="sm" radius="md" style={{ borderColor: 'var(--mantine-color-orange-4)' }}>
          <Text size="xs" c="dimmed">Dynamic (teuer)</Text>
          <Text fw={700} c="orange">{fmtTokens(dynamic || 0)} tokens</Text>
          <Text size="xs" c="dimmed">× input rate</Text>
        </Paper>
      </SimpleGrid>
      <Table withTableBorder withColumnBorders fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Section</Table.Th>
            <Table.Th ta="right">Tokens</Table.Th>
            <Table.Th ta="center">Seite</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((item, i) => (
            <Table.Tr
              key={i}
              style={
                item.side === 'boundary'
                  ? { background: 'var(--mantine-color-dark-5)', fontWeight: 700 }
                  : item.side === 'cached'
                    ? { background: 'rgba(34, 139, 34, 0.12)' }
                    : { background: 'rgba(255, 140, 0, 0.12)' }
              }
            >
              <Table.Td fw={item.side === 'boundary' ? 700 : 400}>{item.section}</Table.Td>
              <Table.Td ta="right">{item.tokens > 0 ? item.tokens.toLocaleString() : '—'}</Table.Td>
              <Table.Td ta="center">
                {item.side !== 'boundary' && (
                  <Badge size="xs" color={item.side === 'cached' ? 'green' : 'orange'}>
                    {item.side}
                  </Badge>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function CostDetail({ items, costMeta }: { items: CostItem[]; costMeta?: VisualizerStep['cost'] }) {
  const { t } = useTranslation();
  if (!costMeta) return null;
  return (
    <Stack gap="sm">
      <SimpleGrid cols={3}>
        <Paper withBorder p="sm" radius="md">
          <Text size="xs" c="dimmed">Mit Cache</Text>
          <Text fw={700} c="teal" size="lg">{fmtCost(costMeta.total_cost)}</Text>
        </Paper>
        <Paper withBorder p="sm" radius="md">
          <Text size="xs" c="dimmed">Ohne Cache</Text>
          <Text fw={700} c="red" size="lg">{fmtCost(costMeta.nocache_total)}</Text>
        </Paper>
        <Paper withBorder p="sm" radius="md">
          <Text size="xs" c="dimmed">Ersparnis</Text>
          <Text fw={700} c="green" size="lg">{fmtCost(costMeta.savings)}</Text>
          <Text size="xs" c="green">({costMeta.savings_pct.toFixed(1)}%)</Text>
        </Paper>
      </SimpleGrid>
      <Table withTableBorder withColumnBorders fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Komponente</Table.Th>
            <Table.Th ta="right">Tokens</Table.Th>
            <Table.Th ta="right">Rate ($/1M)</Table.Th>
            <Table.Th ta="right">{t('visualizer.cost')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((item, i) => (
            <Table.Tr key={i}>
              <Table.Td>{item.label}</Table.Td>
              <Table.Td ta="right">{item.tokens.toLocaleString()}</Table.Td>
              <Table.Td ta="right">${item.rate}</Table.Td>
              <Table.Td ta="right" fw={600}>{fmtCost(item.cost)}</Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
            <Table.Td fw={700} colSpan={3}>Total</Table.Td>
            <Table.Td ta="right" fw={700}>{fmtCost(costMeta.total_cost)}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">{t('visualizer.model', 'Model')}: {costMeta.model_id} | Input: ${costMeta.prices.input}/1M | Cache-Read: ${costMeta.prices.cache_read}/1M | Output: ${costMeta.prices.output}/1M</Text>
    </Stack>
  );
}

/* ---- Real prompt run type ---- */
interface ApiCallDetail {
  tokens: number;
  output: number;
  cost: number;
  response_preview: string;
}

interface RealPromptRun {
  session_id: string;
  turn_index: number;
  timestamp: string;
  model: string;
  user_message: string;
  api_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  total_tokens: number;
  cost_total: number;
  cost_input: number;
  cost_output: number;
  cost_cache_read: number;
  cost_cache_write: number;
  cache_pct: number;
}

interface RealPromptRunDetail {
  session_id: string;
  turn_index: number;
  assistant_response: string;
  api_call_details: ApiCallDetail[];
}

/* ---- Main PromptVisualizer component ---- */
export const PromptVisualizer: React.FC = () => {
  const { t } = useTranslation();
  const [agent, setAgent] = useState('main');
  const [model, setModel] = useState('claude-opus-4-6');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VisualizerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [realRuns, setRealRuns] = useState<RealPromptRun[]>([]);
  const [realLoading, setRealLoading] = useState(false);
  const [showReal, setShowReal] = useState(false);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [realRunDetails, setRealRunDetails] = useState<Record<string, RealPromptRunDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [hasMore, setHasMore] = useState(true);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(600);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const listContainerRef = React.useRef<HTMLDivElement | null>(null);
  const rowRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const rowObservers = React.useRef<Record<string, ResizeObserver>>({});
  const realLoadingRef = React.useRef(false);

  const AGENTS = [
    { value: 'main', label: 'Main' },
    { value: 'worker', label: 'worker (Subagent)' },
    { value: 'gclight', label: 'gclight (Light)' },
  ];

  const MODELS = [
    { value: 'claude-opus-4-6', label: 'claude-opus-4-6 ($5/$25)' },
    { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6 ($3/$15)' },
    { value: 'claude-haiku-4-5', label: 'claude-haiku-4-5 ($0.8/$4)' },
  ];

  const runVisualize = async (overrideText?: string) => {
    const finalText = overrideText ?? text;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/visualize-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: finalText, agent, model }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: VisualizerResult = await res.json();
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const totalCachedPct = result
    ? Math.round((result.cached_tokens / result.total_tokens) * 100)
    : 0;
  const canVisualize = text.trim().length > 0;

  const PAGE_SIZE = 20;
  const getRunKey = (run: Pick<RealPromptRun, 'session_id' | 'turn_index'>) => `${run.session_id}:${run.turn_index}`;

  const loadRealRuns = async (agentOverride?: string, append = false) => {
    if (realLoadingRef.current) return;
    const a = agentOverride ?? agent;
    const currentOffset = append ? realRuns.length : 0;
    setShowReal(true);
    setRealLoading(true);
    realLoadingRef.current = true;
    try {
      const res = await fetch(`/api/real-prompts?limit=${PAGE_SIZE}&offset=${currentOffset}&agent=${encodeURIComponent(a)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (append) {
          setRealRuns(prev => [...prev, ...data]);
        } else {
          setRealRuns(data);
        }
        setHasMore(data.length >= PAGE_SIZE);
      }
    } catch (_) { /* ignore */ }
    setRealLoading(false);
    realLoadingRef.current = false;
  };

  const loadRealRunDetail = async (run: RealPromptRun) => {
    const key = getRunKey(run);
    if (realRunDetails[key] || detailLoading[key]) return;
    setDetailLoading(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(`/api/real-prompts/${encodeURIComponent(run.session_id)}/${run.turn_index}`, { credentials: 'include' });
      if (res.ok) {
        const data: RealPromptRunDetail = await res.json();
        setRealRunDetails(prev => ({ ...prev, [key]: data }));
        requestAnimationFrame(() => {
          const el = rowRefs.current[key];
          if (el) {
            const nextHeight = Math.ceil(el.getBoundingClientRect().height);
            setRowHeights(prev => prev[key] === nextHeight ? prev : { ...prev, [key]: nextHeight });
          }
        });
      }
    } catch (_) { /* ignore */ }
    setDetailLoading(prev => ({ ...prev, [key]: false }));
  };

  // Reset current view when agent changes, then load matching real runs
  React.useEffect(() => {
    setLoading(false);
    setResult(null);
    setError(null);
    setText('');
    setRealRuns([]);
    setHasMore(true);
    setExpandedRuns(new Set());
    setRealRunDetails({});
    setDetailLoading({});
    setRowHeights({});
    setListScrollTop(0);
    loadRealRuns(agent);
  }, [agent]);

  React.useEffect(() => {
    const node = listContainerRef.current;
    if (!node) return;

    const updateSize = () => setListViewportHeight(node.clientHeight || 600);
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [showReal, realRuns.length]);

  React.useEffect(() => {
    return () => {
      Object.values(rowObservers.current).forEach((observer) => observer.disconnect());
      rowObservers.current = {};
    };
  }, []);

  const OVERSCAN = 4;
  const FOOTER_HEIGHT = 44;
  const estimatedHeights = realRuns.map((run) => {
    const key = getRunKey(run);
    return rowHeights[key] ?? (expandedRuns.has(key) ? 520 : 88);
  });
  const offsets: number[] = [];
  let runningOffset = 0;
  for (const height of estimatedHeights) {
    offsets.push(runningOffset);
    runningOffset += height + 8;
  }
  const totalVirtualHeight = runningOffset + FOOTER_HEIGHT;

  let startIndex = 0;
  while (startIndex < realRuns.length && offsets[startIndex] + estimatedHeights[startIndex] < listScrollTop) {
    startIndex += 1;
  }
  startIndex = Math.max(0, startIndex - OVERSCAN);

  let endIndex = startIndex;
  const maxVisibleBottom = listScrollTop + listViewportHeight;
  while (endIndex < realRuns.length && offsets[endIndex] < maxVisibleBottom) {
    endIndex += 1;
  }
  endIndex = Math.min(realRuns.length, endIndex + OVERSCAN);

  const visibleRuns = realRuns.slice(startIndex, endIndex);

  const measureRow = (key: string, el: HTMLDivElement | null) => {
    const prevEl = rowRefs.current[key];
    if (prevEl === el && el) return;

    if (rowObservers.current[key]) {
      rowObservers.current[key].disconnect();
      delete rowObservers.current[key];
    }

    rowRefs.current[key] = el;
    if (!el) return;

    const updateHeight = () => {
      const nextHeight = Math.ceil(el.getBoundingClientRect().height);
      setRowHeights(prev => prev[key] === nextHeight ? prev : { ...prev, [key]: nextHeight });
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    rowObservers.current[key] = observer;
  };

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setListScrollTop(target.scrollTop);
    if (hasMore && !realLoading && target.scrollTop + target.clientHeight >= target.scrollHeight - 300) {
      loadRealRuns(agent, true);
    }
  };

  return (
    <Stack gap="md">
      {/* Hero Header */}
      <Card withBorder radius="md" p="lg" style={{
        background: 'linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(59,130,246,0.08) 100%)',
        borderColor: 'var(--mantine-color-violet-4)',
        borderWidth: 2,
      }}>
        <Group gap="sm" mb="xs">
          <ThemeIcon size={44} radius="md" variant="gradient" gradient={{ from: 'violet', to: 'blue', deg: 135 }}>
            <IconSparkles size={24} />
          </ThemeIcon>
          <Stack gap={0}>
            <Group gap={8}>
              <Title order={3}>{t('visualizer.title', 'Prompt Visualizer')}</Title>
              <Text component="span" size="10px" fw={700} c="white" px={6} py={2} style={{ borderRadius: 4, background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)' }}>✦ Clawscope</Text>
            </Group>
            <Text size="sm" c="dimmed">{t('visualizer.description')}</Text>
          </Stack>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} mb="sm">
          <Select
            label={t('visualizer.agent', 'Agent')}
            data={AGENTS}
            value={agent}
            onChange={v => setAgent(v || 'main')}
            size="sm"
          />
          <Select
            label={t('visualizer.model', 'Model')}
            data={MODELS}
            value={model}
            onChange={v => setModel(v || 'claude-opus-4-6')}
            size="sm"
          />
          <div />
        </SimpleGrid>

        <Stack gap="xs">
          <Textarea
            label={t('visualizer.userMessage', 'Sample message')}
            placeholder={t('visualizer.placeholder', 'e.g. How\'s the weather tomorrow?')}
            value={text}
            onChange={e => setText(e.target.value)}
            size="sm"
            minRows={2}
            maxRows={4}
            autosize
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runVisualize(); } }}
          />
          <Button
            leftSection={<IconPlayerPlay size={16} />}
            onClick={() => runVisualize()}
            loading={loading}
            disabled={!canVisualize}
            color="violet"
            size="sm"
            fullWidth
          >
            {t('visualizer.run', 'Visualize')}
          </Button>
        </Stack>
      </Card>

      {/* Loading */}
      {loading && (
        <Center py="xl">
          <Stack align="center" gap="sm">
            <Loader color="violet" size="lg" />
            <Text c="dimmed" size="sm">{t('visualizer.analyzing', 'Analyzing pipeline...')}</Text>
          </Stack>
        </Center>
      )}

      {/* Error */}
      {error && (
        <Alert color="red" icon={<IconX size={16} />} title="Fehler">
          {error}
        </Alert>
      )}

      {/* Results */}
      {result && !loading && (
        <Stack gap={0}>
          {/* Summary bar */}
          <Card withBorder radius="md" mb="md" p="sm">
            <Group justify="space-between" mb="xs">
              <Text size="sm" fw={600}>{t('visualizer.totalTokens', { tokens: fmtTokens(result.total_tokens) })}</Text>
              <Group gap="xs">
                <Badge color="green" variant="light">{fmtTokens(result.cached_tokens)} cached</Badge>
                <Badge color="orange" variant="light">{fmtTokens(result.uncached_tokens)} dynamic</Badge>
                <Badge color="blue" variant="filled">{fmtCost(result.cost.total_cost)}</Badge>
              </Group>
            </Group>
            <Progress.Root size="md" radius="xl">
              <Progress.Section value={totalCachedPct} color="green">
                <Progress.Label>{totalCachedPct}% cached</Progress.Label>
              </Progress.Section>
              <Progress.Section value={100 - totalCachedPct} color="orange">
                <Progress.Label>{100 - totalCachedPct}% dynamic</Progress.Label>
              </Progress.Section>
            </Progress.Root>
            {result.matched_skill && (
              <Paper mt="sm" p="sm" radius="md" style={{ background: 'linear-gradient(135deg, var(--mantine-color-blue-9), var(--mantine-color-indigo-9))', border: '1px solid var(--mantine-color-blue-7)' }}>
                <Group gap="sm">
                  <ThemeIcon size={32} radius="md" color="blue" variant="filled">
                    <IconSparkles size={18} />
                  </ThemeIcon>
                  <div>
                    <Text size="sm" fw={700} c="white">
                      {t('visualizer.skillLoaded', { skill: result.matched_skill })}
                    </Text>
                    <Text size="xs" c="blue.2">
                      +{fmtTokens(result.skill_load_tokens)} tokens aus SKILL.md
                    </Text>
                  </div>
                </Group>
              </Paper>
            )}
          </Card>

          {/* Pipeline steps */}
          {result.steps.map((step, i) => (
            <StepNode key={step.id} step={step} index={i} />
          ))}

          {/* Assembled preview */}
          {result.assembled_prompt_preview && (
            <Card withBorder radius="md" mt="md" p="sm">
              <Text size="xs" fw={600} mb="xs" c="dimmed">ASSEMBLED PROMPT PREVIEW ({result.assembled_prompt_preview.length.toLocaleString()} Zeichen)</Text>
              <Paper p="sm" radius="sm" style={{ background: 'var(--mantine-color-dark-7, #1a1b1e)', color: 'var(--mantine-color-green-4, #69db7c)', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 600, overflowY: 'auto', lineHeight: 1.5 }}>
                {result.assembled_prompt_preview}
              </Paper>
            </Card>
          )}
        </Stack>
      )}

      {/* Real Prompt Runs */}
      <Card withBorder radius="md" p="md">
        <Group justify="space-between" mb="sm">
          <Stack gap={0}>
            <Text fw={600} size="sm">{t('visualizer.realRuns', 'Real Prompt Runs')}</Text>
            <Text size="xs" c="dimmed">{t('visualizer.realRunsDesc', 'Token usage and costs from actual API calls in session logs')}</Text>
          </Stack>
          <Button
            variant="light"
            color="violet"
            size="xs"
            onClick={() => loadRealRuns()}
            loading={realLoading}
          >
            {showReal ? t('visualizer.refresh', 'Refresh') : t('visualizer.loadRuns', 'Load')}
          </Button>
        </Group>

        {showReal && realRuns.length > 0 && (
          <div
            ref={listContainerRef}
            onScroll={handleListScroll}
            style={{ maxHeight: '70vh', overflowY: 'auto', position: 'relative' }}
          >
            <div style={{ height: totalVirtualHeight, position: 'relative' }}>
            {visibleRuns.map((run, visibleIndex) => {
              const actualIndex = startIndex + visibleIndex;
              const runKey = getRunKey(run);
              const expanded = expandedRuns.has(runKey);
              const detail = realRunDetails[runKey];
              const toggleExpand = () => {
                setExpandedRuns(prev => {
                  const next = new Set(prev);
                  if (next.has(runKey)) {
                    next.delete(runKey);
                  } else {
                    next.add(runKey);
                    setRowHeights(heights => ({ ...heights, [runKey]: Math.max(heights[runKey] || 0, 520) }));
                  }
                  return next;
                });
                if (!expanded) {
                  loadRealRunDetail(run);
                }
              };
              return (
                <div
                  key={runKey}
                  ref={(el) => measureRow(runKey, el)}
                  style={{ position: 'absolute', top: offsets[actualIndex], left: 0, right: 0 }}
                >
                <Card withBorder p="sm" style={{ cursor: 'pointer' }} onClick={toggleExpand}>
                  {/* Row 1: timestamp left, cost right */}
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {new Date(run.timestamp).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </Text>
                    <Group gap={8} wrap="nowrap">
                      <Text size="sm" fw={700}>{fmtCost(run.cost_total)}</Text>
                      <Text size="sm" c="dimmed">{expanded ? '▲' : '▼'}</Text>
                    </Group>
                  </Group>
                  {/* Zeile 2: Model + Calls + Cache — immer gleiche Höhe */}
                  <Group gap={6} mt={4}>
                    <Badge size="sm" color={run.model.includes('opus') ? 'violet' : run.model.includes('sonnet') ? 'blue' : run.model.includes('kimi') ? 'yellow' : 'gray'} variant="filled">
                      {run.model.replace('claude-', '').replace('moonshotai/', '')}
                    </Badge>
                    {run.api_calls > 1 && (
                      <Badge size="sm" color="orange" variant="light">{run.api_calls}×</Badge>
                    )}
                    <Badge size="sm" color={run.cache_pct > 90 ? 'green' : run.cache_pct > 50 ? 'yellow' : 'red'} variant="light">
                      Cache {run.cache_pct}%
                    </Badge>
                  </Group>


                  <Collapse expanded={expanded}>
                    {expanded && <Stack gap="xs" mt="xs" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      {/* Token breakdown */}
                      <Group gap="xs" wrap="wrap">
                        <Badge size="xs" variant="outline" color="gray">In: {run.input_tokens.toLocaleString()}</Badge>
                        <Badge size="xs" variant="outline" color="green">Cache: {run.cache_read.toLocaleString()}</Badge>
                        <Badge size="xs" variant="outline" color="gray">Out: {run.output_tokens.toLocaleString()}</Badge>
                        <Badge size="xs" variant="outline" color="blue">Σ {run.total_tokens.toLocaleString()}</Badge>
                      </Group>

                      {/* Visualize this run — THE killer feature */}
                      <Button
                        size="md"
                        variant="gradient"
                        gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
                        leftSection={<IconPlayerPlay size={18} />}
                        fullWidth
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          const msg = run.user_message || '';
                          setText(msg);
                          const runModel = run.model || '';
                          const matchedModel = MODELS.find(m => runModel.includes(m.value));
                          if (matchedModel) setModel(matchedModel.value);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                          runVisualize(msg);
                        }}
                      >
                        {t('visualizer.visualizePrompt')}
                      </Button>

                      {/* User message */}
                      <div>
                        <Text size="xs" fw={600} mb={4}>{t('visualizer.message')}</Text>
                        <Paper p="xs" bg="var(--mantine-color-dark-7)" style={{ borderRadius: 4 }}>
                          <Text size="xs" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', color: 'var(--mantine-color-blue-4)' }}>
                            {run.user_message || '—'}
                          </Text>
                        </Paper>
                      </div>

                      {/* Assistant response */}
                      <div>
                        <Text size="xs" fw={600} mb={4}>{t('visualizer.answer')}</Text>
                        <Paper p="xs" bg="var(--mantine-color-dark-7)" style={{ borderRadius: 4, maxHeight: 400, overflow: 'auto' }}>
                          <Text size="xs" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', color: 'var(--mantine-color-green-4)' }}>
                            {detailLoading[runKey] ? 'Loading…' : (detail?.assistant_response || '—')}
                          </Text>
                        </Paper>
                      </div>



                      {/* API call breakdown */}
                      {run.api_calls > 1 && detail?.api_call_details && (
                        <div>
                          <Text size="xs" fw={600} mb={4}>🔄 {run.api_calls} API-Calls in diesem Turn:</Text>
                          <Stack gap={4}>
                            {detail.api_call_details.map((call, ci) => (
                              <Paper key={ci} p="xs" bg="var(--mantine-color-dark-8)" style={{ borderRadius: 4, borderLeft: '3px solid var(--mantine-color-violet-6)' }}>
                                <Group gap="xs" wrap="wrap">
                                  <Text size="xs" c="dimmed">#{ci + 1}</Text>
                                  <Badge size="xs" variant="dot" color="gray">Tok: {call.tokens.toLocaleString()}</Badge>
                                  <Badge size="xs" variant="dot" color="gray">Out: {call.output.toLocaleString()}</Badge>
                                  <Text size="xs" fw={600}>{fmtCost(call.cost)}</Text>
                                </Group>
                                {call.response_preview && (
                                  <Text size="xs" c="dimmed" mt={4} lineClamp={2} style={{ fontFamily: 'monospace' }}>
                                    {call.response_preview}
                                  </Text>
                                )}
                              </Paper>
                            ))}
                          </Stack>
                        </div>
                      )}
                    </Stack>}
                  </Collapse>
                </Card>
                </div>
              );
            })}
            <div style={{ position: 'absolute', left: 0, right: 0, top: Math.max(runningOffset, 0), height: FOOTER_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {hasMore && realLoading && <Text size="xs" c="dimmed">{t('visualizer.loadingMore')}</Text>}
              {!hasMore && realRuns.length > 0 && (
                <Text size="xs" c="dimmed" ta="center" py="xs">{t('visualizer.allLoaded', { count: realRuns.length })}</Text>
              )}
            </div>
            </div>
          </div>
        )}

        {showReal && realRuns.length === 0 && !realLoading && (
          <Text size="sm" c="dimmed" ta="center" py="md">{t('visualizer.noRuns')}</Text>
        )}
      </Card>
    </Stack>
  );
};
