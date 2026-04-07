import React, { useState, useEffect } from 'react';
import {
  Card,
  Title,
  Text,
  Stack,
  Group,
  Code,
  Loader,
  Center,
  Badge,
  Select,
  Accordion,
  Paper,
  SimpleGrid,
  ThemeIcon,
  ScrollArea,
  List,
  Table,
} from '@mantine/core';
import {
  IconFile,
  IconHash,
  IconDatabase,
  IconPuzzle,
  IconBolt,
  IconShieldCheck,
  IconPlug,
  IconArchive,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

interface PromptFile {
  name: string;
  path: string;
  size: number;
  tokens_est: number;
  content: string;
  type: 'injected' | 'agent-loaded' | 'missing';
}

interface SkillInfo {
  name: string;
  source: 'builtin' | 'user';
  location: string;
  description: string;
}

interface PluginInfo {
  name: string;
  type: string;
  enabled: boolean;
  effect_on_prompt: string;
}

interface CompressionInfo {
  active: boolean;
  plugin_slot?: string | null;
  db_path?: string | null;
  threshold?: string | null;
  summarizer_model?: string | null;
  effect_on_context: string;
}

interface SystemPromptData {
  agent: string;
  workspace: string;
  files: PromptFile[];
  skills: SkillInfo[];
  skills_count: number;
  skills_total: number;
  skills_chars: number;
  skills_xml: string;
  openclaw_config: Record<string, any>;
  openclaw_config_chars: number;
  runtime_sections: string[];
  plugins?: PluginInfo[];
  extensions_count?: number;
  compression?: CompressionInfo;
  total_chars: number;
  total_tokens_est: number;
  file_count: number;
}

export const SystemPrompt: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<SystemPromptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState('main');

  const agents = [
    { value: 'main', label: 'main (Opus)' },
    { value: 'worker', label: 'worker (Sonnet)' },
    { value: 'research', label: 'research' },
    { value: 'strategie', label: 'strategie' },
    { value: 'qs', label: 'qs' },
    { value: 'verlag', label: 'verlag' },
    { value: 'gclight', label: 'gclight' },
  ];

  useEffect(() => {
    fetchPrompt();
  }, [agent]);

  const fetchPrompt = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/system-prompt?agent=${agent}`, {
        credentials: 'include',
      });
      const d = await resp.json();
      setData(d);
    } catch (e) {
      console.error('Failed to fetch system prompt:', e);
    } finally {
      setLoading(false);
    }
  };

  const formatSize = (chars: number) => {
    if (chars >= 1000000) return `${(chars / 1000000).toFixed(1)}M`;
    if (chars >= 1000) return `${(chars / 1000).toFixed(1)}K`;
    return `${chars}`;
  };

  if (loading) {
    return <Center p="xl"><Loader size="lg" /></Center>;
  }

  if (!data) {
    return <Text c="dimmed">{t('systemPrompt.failed', 'Failed to load system prompt')}</Text>;
  }

  const workspaceFiles = data.files.filter(f => f.type !== 'missing');
  const workspaceChars = workspaceFiles.reduce((s, f) => s + f.size, 0);

  // Calculate per-section token costs for the breakdown
  const sections = [
    { label: t('systemPrompt.sections.workspaceFiles', 'Workspace Files'), chars: workspaceChars, color: 'blue' },
    { label: t('systemPrompt.sections.skills', 'Skills XML Block'), chars: data.skills_chars, color: 'violet' },
    { label: t('systemPrompt.sections.runtime', 'Runtime Directives'), chars: Math.round(data.total_chars - workspaceChars - data.skills_chars), color: 'teal' },
  ];

  const plugins = data.plugins || [];
  const compression = data.compression;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={2}>{t('systemPrompt.title', 'System Prompt')}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t('systemPrompt.description', 'What actually gets sent with every API call — the full context window cost breakdown.')}
          </Text>
        </div>
        <Select
          value={agent}
          onChange={(v) => v && setAgent(v)}
          data={agents}
          w={200}
          label={t('systemPrompt.agent', 'Agent')}
        />
      </Group>

      {/* Token Cost Breakdown */}
      <Card withBorder>
        <Title order={4} mb="md">{t('systemPrompt.costBreakdown', 'Prompt Size Breakdown')}</Title>
        <Text size="sm" c="dimmed" mb="md">
          {t('systemPrompt.costBreakdownDesc', 'Every message to this agent includes all of this as system prompt context. This is the baseline cost before any user message or conversation history.')}
        </Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mb="md">
          {sections.map((s) => (
            <Paper withBorder p="md" radius="md" key={s.label}>
              <Text size="xs" c="dimmed">{s.label}</Text>
              <Text fw={700} size="lg">~{formatSize(s.chars / 4)}</Text>
              <Text size="xs" c="dimmed">tokens ({formatSize(s.chars)} chars)</Text>
            </Paper>
          ))}
        </SimpleGrid>
        <Paper withBorder p="md" radius="md" bg="var(--mantine-color-dark-6)">
          <Group justify="space-between">
            <Text fw={600}>{t('systemPrompt.totalPrompt', 'Total System Prompt')}</Text>
            <Group gap="lg">
              <div>
                <Text fw={700} size="xl" ta="right">~{formatSize(data.total_tokens_est)}</Text>
                <Text size="xs" c="dimmed" ta="right">tokens</Text>
              </div>
              <div>
                <Text fw={700} size="xl" ta="right">{formatSize(data.total_chars)}</Text>
                <Text size="xs" c="dimmed" ta="right">chars</Text>
              </div>
            </Group>
          </Group>
        </Paper>
      </Card>

      {/* 1. Workspace Files */}
      <Card withBorder>
        <Group gap="sm" mb="md">
          <ThemeIcon color="blue" variant="light" size="sm"><IconFile size={14} /></ThemeIcon>
          <Title order={4}>{t('systemPrompt.sections.workspaceFiles', 'Workspace Files')}</Title>
          <Badge variant="light" size="sm">{workspaceFiles.length} files · ~{formatSize(workspaceChars / 4)} tok</Badge>
        </Group>
        <Text size="sm" c="dimmed" mb="md">
          {t('systemPrompt.sections.workspaceFilesDesc', 'Markdown files injected into every prompt. AGENTS.md, SOUL.md, USER.md etc. define personality, memory, rules, and user context. Full content is sent every time.')}
        </Text>
        <Accordion variant="separated">
          {workspaceFiles.map((file) => (
            <Accordion.Item key={file.name} value={file.name}>
              <Accordion.Control>
                <Group justify="space-between" pr="md" wrap="wrap">
                  <Group gap="sm">
                    <Text fw={500} size="sm">{file.name}</Text>
                    <Badge variant="outline" size="xs" color={file.type === 'injected' ? 'green' : 'yellow'}>
                      {file.type === 'injected'
                        ? t('systemPrompt.badges.autoInjected', 'auto-injected')
                        : t('systemPrompt.badges.agentLoaded', 'agent-loaded')}
                    </Badge>
                  </Group>
                  <Group gap="xs">
                    <Badge variant="light" size="xs" color="gray">~{formatSize(file.tokens_est)} tok</Badge>
                    <Badge variant="light" size="xs" color="blue">{formatSize(file.size)} chars</Badge>
                  </Group>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <ScrollArea.Autosize mah={500} type="auto">
                  <Code block style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                    {file.content}
                  </Code>
                </ScrollArea.Autosize>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Card>

      {/* 2. Skills — the actual injected XML block */}
      {data.skills && data.skills.length > 0 && (
        <Card withBorder>
          <Group gap="sm" mb="md">
            <ThemeIcon color="violet" variant="light" size="sm"><IconPuzzle size={14} /></ThemeIcon>
            <Title order={4}>{t('systemPrompt.sections.skills', 'Skills')}</Title>
            <Badge variant="light" size="sm">{data.skills_count} of {data.skills_total || '?'} active · ~{formatSize(data.skills_chars / 4)} tok</Badge>
          </Group>
          <Text size="sm" c="dimmed" mb="md">
            {t('systemPrompt.sections.skillsDesc', 'Only the skill index below is sent with every prompt (name + description + path). The full SKILL.md is loaded on-demand only when a skill triggers — not part of the baseline cost.')}
          </Text>

          {/* Skill table */}
          <ScrollArea>
            <Table highlightOnHover withTableBorder withColumnBorders fontSize="xs" mb="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Skill</Table.Th>
                  <Table.Th>Source</Table.Th>
                  <Table.Th>Description</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.skills.map((sk) => (
                  <Table.Tr key={sk.name}>
                    <Table.Td><Text fw={500} size="xs">{sk.name}</Text></Table.Td>
                    <Table.Td>
                      <Badge variant="outline" size="xs" color={sk.source === 'user' ? 'orange' : 'gray'}>
                        {sk.source}
                      </Badge>
                    </Table.Td>
                    <Table.Td><Text size="xs" lineClamp={2}>{sk.description || '—'}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>

          {/* Show the actual XML that gets injected */}
          <Accordion variant="separated">
            <Accordion.Item value="xml">
              <Accordion.Control>
                <Text size="sm" fw={500}>{t('systemPrompt.sections.skillsXml', 'Injected XML Block (as sent in prompt)')}</Text>
              </Accordion.Control>
              <Accordion.Panel>
                <ScrollArea.Autosize mah={500} type="auto">
                  <Code block style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                    {data.skills_xml}
                  </Code>
                </ScrollArea.Autosize>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Card>
      )}

      {/* 3. Runtime Sections */}
      {data.runtime_sections && data.runtime_sections.length > 0 && (
        <Card withBorder>
          <Group gap="sm" mb="md">
            <ThemeIcon color="teal" variant="light" size="sm"><IconBolt size={14} /></ThemeIcon>
            <Title order={4}>{t('systemPrompt.sections.runtime', 'Runtime Prompt Sections')}</Title>
          </Group>
          <Text size="sm" c="dimmed" mb="md">
            {t('systemPrompt.sections.runtimeDesc', 'These sections are dynamically generated and injected by the OpenClaw runtime at every API call. Content varies by channel, session type, and active plugins. Not stored in files.')}
          </Text>
          <List spacing="xs" size="sm">
            {data.runtime_sections.map((section, i) => (
              <List.Item key={i} icon={
                <ThemeIcon color="teal" variant="light" size={20} radius="xl">
                  <IconShieldCheck size={12} />
                </ThemeIcon>
              }>
                {section}
              </List.Item>
            ))}
          </List>
        </Card>
      )}

      {/* 4. Plugins / Compression */}
      <Card withBorder>
        <Group gap="sm" mb="md">
          <ThemeIcon color="orange" variant="light" size="sm"><IconPlug size={14} /></ThemeIcon>
          <Title order={4}>{t('systemPrompt.sections.plugins', 'Plugins & Compression')}</Title>
          <Badge variant="light" size="sm">{plugins.length} active extension{plugins.length === 1 ? '' : 's'}</Badge>
        </Group>
        <Text size="sm" c="dimmed" mb="md">
          {t('systemPrompt.sections.pluginsDesc', 'Extensions and compression plugins can change how context is stored, recalled, or exposed to the runtime. This explains why compressed sessions may behave differently from raw chat history.')}
        </Text>

        {plugins.length > 0 ? (
          <Stack gap="sm" mb="md">
            {plugins.map((plugin) => (
              <Paper key={plugin.name} withBorder p="md" radius="md">
                <Group justify="space-between" mb={6}>
                  <Group gap="sm">
                    <Text fw={600}>{plugin.name}</Text>
                    <Badge variant="outline" size="xs" color={plugin.enabled ? 'green' : 'gray'}>
                      {plugin.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                    <Badge variant="light" size="xs" color="orange">{plugin.type}</Badge>
                  </Group>
                </Group>
                <Text size="sm" c="dimmed">{plugin.effect_on_prompt}</Text>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed" mb="md">{t('systemPrompt.sections.noPlugins', 'No active extension plugins detected.')}</Text>
        )}

        {compression && (
          <Paper withBorder p="md" radius="md" bg="var(--mantine-color-dark-6)">
            <Group gap="sm" mb="sm">
              <ThemeIcon color="grape" variant="light" size="sm"><IconArchive size={14} /></ThemeIcon>
              <Text fw={600}>{t('systemPrompt.sections.compression', 'Compression / LCM')}</Text>
              <Badge variant="light" size="xs" color={compression.active ? 'green' : 'gray'}>
                {compression.active ? 'active' : 'inactive'}
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mb="sm">
              <div>
                <Text size="xs" c="dimmed">Plugin slot</Text>
                <Code>{compression.plugin_slot || '—'}</Code>
              </div>
              <div>
                <Text size="xs" c="dimmed">Threshold</Text>
                <Code>{compression.threshold || '—'}</Code>
              </div>
              <div>
                <Text size="xs" c="dimmed">Summarizer model</Text>
                <Code>{compression.summarizer_model || '—'}</Code>
              </div>
              <div>
                <Text size="xs" c="dimmed">DB</Text>
                <Code>{compression.db_path || '—'}</Code>
              </div>
            </SimpleGrid>
            <Text size="sm" c="dimmed">{compression.effect_on_context}</Text>
          </Paper>
        )}
      </Card>
    </Stack>
  );
};
