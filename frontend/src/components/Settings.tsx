import React, { useState, useEffect } from 'react';
import {
  Card, Title, Text, Stack, Group, TextInput, PasswordInput, Button,
  Table, ActionIcon, Alert, Loader, Center, Divider, NumberInput,
  Code, Textarea, Tooltip, Badge, SimpleGrid,
} from '@mantine/core';
import { IconPlus, IconTrash, IconDeviceFloppy, IconCheck, IconAlertCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { Select } from '@mantine/core';
import { api } from '../services/api';

interface User {
  id: string;
  name: string;
  category: string;
}

interface KnownSession {
  uuid: string;
  user: string;
}

interface ApiKeyLabel {
  key: string;
  label: string;
}

interface ModelPricing {
  model: string;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export const Settings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auth
  const [password, setPassword] = useState('');
  const [tokenExpireHours, setTokenExpireHours] = useState(24);

  // Paths
  const [sessionsDir, setSessionsDir] = useState('');
  const [agentsBase, setAgentsBase] = useState('');

  // Users
  const [users, setUsers] = useState<User[]>([]);

  // Known Sessions
  const [knownSessions, setKnownSessions] = useState<KnownSession[]>([]);

  // API Key Labels
  const [apiKeyLabels, setApiKeyLabels] = useState<ApiKeyLabel[]>([]);

  // Model Pricing
  const [modelPricing, setModelPricing] = useState<ModelPricing[]>([]);
  const [defaultPricing, setDefaultPricing] = useState({ input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 });

  // User Categories
  const [userCategories, setUserCategories] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await api.getSettings();

      setPassword('');
      setTokenExpireHours(data.auth?.token_expire_hours || 24);
      setSessionsDir(data.paths?.sessions_dir || '~/.openclaw/agents/main/sessions');
      setAgentsBase(data.paths?.agents_base || '~/.openclaw/agents');
      setUsers((data.users || []).map((u: any) => ({
        id: String(u.id || ''),
        name: u.name || '',
        category: u.category || 'user',
      })));

      const ks = data.known_sessions || {};
      setKnownSessions(Object.entries(ks).map(([uuid, user]) => ({ uuid, user: user as string })));

      const akl = data.api_key_labels || {};
      setApiKeyLabels(Object.entries(akl).map(([key, label]) => ({ key, label: label as string })));

      const mp = data.model_pricing || {};
      setModelPricing(Object.entries(mp).map(([model, p]: [string, any]) => ({
        model,
        input: p.input || 0,
        output: p.output || 0,
        cache_write: p.cache_write || 0,
        cache_read: p.cache_read || 0,
      })));

      setDefaultPricing(data.default_pricing || { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 });
      setUserCategories(data.user_categories || {});
    } catch (err) {
      setError(t('settings.loading'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      const configData: Record<string, any> = {
        auth: {
          password: password || '••••••••',
          secret_key: '••••••••',
          token_expire_hours: tokenExpireHours,
        },
        paths: {
          sessions_dir: sessionsDir,
          agents_base: agentsBase,
        },
        users: users.filter(u => u.id && u.name),
        known_sessions: Object.fromEntries(knownSessions.filter(s => s.uuid && s.user).map(s => [s.uuid, s.user])),
        api_key_labels: Object.fromEntries(apiKeyLabels.filter(a => a.key && a.label).map(a => [a.key, a.label])),
        default_pricing: defaultPricing,
        model_pricing: Object.fromEntries(modelPricing.filter(m => m.model).map(m => [m.model, {
          input: m.input,
          output: m.output,
          cache_write: m.cache_write,
          cache_read: m.cache_read,
        }])),
        user_categories: userCategories,
      };

      await api.updateSettings(configData);

      if (password && password.length >= 6) {
        await api.updatePassword(password);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Center p="xl"><Loader /></Center>;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>⚙️ {t('settings.title')}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t('settings.description')}
          </Text>
        </div>
        <Group>
          {saved && <Badge color="green" leftSection={<IconCheck size={12} />}>{t('settings.saved')}</Badge>}
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            onClick={handleSave}
            loading={saving}
          >
            {t('settings.save')}
          </Button>
        </Group>
      </Group>

      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}

      {/* Language */}
      <Card withBorder>
        <Title order={5} mb="md">🌐 {t('settings.language', 'Language')}</Title>
        <Stack gap="sm">
          <div>
            <Select
              label={t('settings.languageSelect', 'Interface Language')}
              value={i18n.language.startsWith('de') ? 'de' : 'en'}
              onChange={(v) => { if (v) { localStorage.setItem('clawscope-lang', v); i18n.changeLanguage(v); } }}
              data={[
                { value: 'en', label: '🇬🇧 English' },
                { value: 'de', label: '🇩🇪 Deutsch' },
              ]}
              w={250}
            />
            <Text size="xs" c="dimmed" mt={6}>
              {t('settings.languageHint', 'Saved in localStorage. Add translations in:')}{' '}
              <Code>frontend/src/i18n/&lt;lang&gt;.json</Code>
            </Text>
          </div>
        </Stack>
      </Card>

      {/* Authentication */}
      <Card withBorder>
        <Title order={5} mb="md">🔐 {t('settings.auth.title')}</Title>
        <Stack gap="sm">
          <PasswordInput
            label={t('settings.auth.password')}
            description={t('settings.auth.passwordDesc')}
            placeholder={t('settings.auth.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <NumberInput
            label={t('settings.auth.tokenExpiry')}
            description={t('settings.auth.tokenExpiryDesc')}
            value={tokenExpireHours}
            onChange={(v) => setTokenExpireHours(Number(v) || 24)}
            min={1}
            max={720}
          />
        </Stack>
      </Card>

      {/* Paths */}
      <Card withBorder>
        <Title order={5} mb="md">📁 {t('settings.paths.title')}</Title>
        <Stack gap="sm">
          <TextInput
            label={t('settings.paths.sessionsDir')}
            description={t('settings.paths.sessionsDirDesc')}
            value={sessionsDir}
            onChange={(e) => setSessionsDir(e.currentTarget.value)}
          />
          <TextInput
            label={t('settings.paths.agentsBase')}
            description={t('settings.paths.agentsBaseDesc')}
            value={agentsBase}
            onChange={(e) => setAgentsBase(e.currentTarget.value)}
          />
        </Stack>
      </Card>

      {/* Known Users */}
      <Card withBorder>
        <Title order={5} mb="md">👤 {t('settings.users.title')}</Title>
        <Text size="sm" c="dimmed" mb="md">
          {t('settings.users.description')}
        </Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('settings.users.senderId')}</Table.Th>
              <Table.Th>{t('settings.users.displayName')}</Table.Th>
              <Table.Th>{t('settings.users.category')}</Table.Th>
              <Table.Th w={50}></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((user, idx) => (
              <Table.Tr key={idx}>
                <Table.Td>
                  <TextInput size="xs" value={user.id} placeholder={t('settings.users.senderIdPlaceholder')}
                    onChange={(e) => { const u = [...users]; u[idx] = { ...u[idx], id: e.currentTarget.value }; setUsers(u); }} />
                </Table.Td>
                <Table.Td>
                  <TextInput size="xs" value={user.name} placeholder={t('settings.users.displayNamePlaceholder')}
                    onChange={(e) => { const u = [...users]; u[idx] = { ...u[idx], name: e.currentTarget.value }; setUsers(u); }} />
                </Table.Td>
                <Table.Td>
                  <TextInput size="xs" value={user.category} placeholder={t('settings.users.categoryPlaceholder')}
                    onChange={(e) => { const u = [...users]; u[idx] = { ...u[idx], category: e.currentTarget.value }; setUsers(u); }} />
                </Table.Td>
                <Table.Td>
                  <ActionIcon color="red" variant="subtle" onClick={() => setUsers(users.filter((_, i) => i !== idx))}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Button variant="light" size="xs" mt="sm" leftSection={<IconPlus size={14} />}
          onClick={() => setUsers([...users, { id: '', name: '', category: 'user' }])}>
          {t('settings.users.addUser')}
        </Button>
      </Card>

      {/* API Key Labels */}
      <Card withBorder>
        <Title order={5} mb="md">🏷️ {t('settings.apiKeys.title')}</Title>
        <Text size="sm" c="dimmed" mb="md">
          {t('settings.apiKeys.description')}
        </Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('settings.apiKeys.keyId')}</Table.Th>
              <Table.Th>{t('settings.apiKeys.label')}</Table.Th>
              <Table.Th w={50}></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {apiKeyLabels.map((akl, idx) => (
              <Table.Tr key={idx}>
                <Table.Td>
                  <TextInput size="xs" value={akl.key} placeholder={t('settings.apiKeys.keyIdPlaceholder')}
                    onChange={(e) => { const a = [...apiKeyLabels]; a[idx] = { ...a[idx], key: e.currentTarget.value }; setApiKeyLabels(a); }} />
                </Table.Td>
                <Table.Td>
                  <TextInput size="xs" value={akl.label} placeholder={t('settings.apiKeys.labelPlaceholder')}
                    onChange={(e) => { const a = [...apiKeyLabels]; a[idx] = { ...a[idx], label: e.currentTarget.value }; setApiKeyLabels(a); }} />
                </Table.Td>
                <Table.Td>
                  <ActionIcon color="red" variant="subtle" onClick={() => setApiKeyLabels(apiKeyLabels.filter((_, i) => i !== idx))}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Button variant="light" size="xs" mt="sm" leftSection={<IconPlus size={14} />}
          onClick={() => setApiKeyLabels([...apiKeyLabels, { key: '', label: '' }])}>
          {t('settings.apiKeys.addLabel')}
        </Button>
      </Card>

      {/* Known Sessions */}
      <Card withBorder>
        <Title order={5} mb="md">🔗 {t('settings.sessions.title')}</Title>
        <Text size="sm" c="dimmed" mb="md">
          {t('settings.sessions.description')}
        </Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('settings.sessions.uuid')}</Table.Th>
              <Table.Th>{t('settings.sessions.user')}</Table.Th>
              <Table.Th w={50}></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {knownSessions.map((ks, idx) => (
              <Table.Tr key={idx}>
                <Table.Td>
                  <TextInput size="xs" value={ks.uuid} style={{ fontFamily: 'monospace' }}
                    onChange={(e) => { const s = [...knownSessions]; s[idx] = { ...s[idx], uuid: e.currentTarget.value }; setKnownSessions(s); }} />
                </Table.Td>
                <Table.Td>
                  <TextInput size="xs" value={ks.user}
                    onChange={(e) => { const s = [...knownSessions]; s[idx] = { ...s[idx], user: e.currentTarget.value }; setKnownSessions(s); }} />
                </Table.Td>
                <Table.Td>
                  <ActionIcon color="red" variant="subtle" onClick={() => setKnownSessions(knownSessions.filter((_, i) => i !== idx))}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Button variant="light" size="xs" mt="sm" leftSection={<IconPlus size={14} />}
          onClick={() => setKnownSessions([...knownSessions, { uuid: '', user: '' }])}>
          {t('settings.sessions.addSession')}
        </Button>
      </Card>

      {/* Model Pricing */}
      <Card withBorder>
        <Title order={5} mb="md">💲 {t('settings.pricing.title')}</Title>
        <Text size="sm" c="dimmed" mb="md">
          {t('settings.pricing.description')}
        </Text>

        <Card withBorder p="sm" mb="md" style={{ background: 'var(--mantine-color-dark-7, var(--mantine-color-gray-0))' }}>
          <Text size="xs" fw={600} mb="xs" c="dimmed">{t('settings.pricing.default')}</Text>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <NumberInput size="xs" label={t('settings.pricing.input')} value={defaultPricing.input} decimalScale={2} step={0.5}
              onChange={(v) => setDefaultPricing({ ...defaultPricing, input: Number(v) || 0 })} />
            <NumberInput size="xs" label={t('settings.pricing.output')} value={defaultPricing.output} decimalScale={2} step={0.5}
              onChange={(v) => setDefaultPricing({ ...defaultPricing, output: Number(v) || 0 })} />
            <NumberInput size="xs" label={t('settings.pricing.cacheWrite')} value={defaultPricing.cache_write} decimalScale={2} step={0.5}
              onChange={(v) => setDefaultPricing({ ...defaultPricing, cache_write: Number(v) || 0 })} />
            <NumberInput size="xs" label={t('settings.pricing.cacheRead')} value={defaultPricing.cache_read} decimalScale={2} step={0.01}
              onChange={(v) => setDefaultPricing({ ...defaultPricing, cache_read: Number(v) || 0 })} />
          </SimpleGrid>
        </Card>

        <Stack gap="sm">
          {modelPricing.map((mp, idx) => (
            <Card key={idx} withBorder p="sm">
              <Group justify="space-between" mb="xs">
                <TextInput size="xs" value={mp.model} placeholder={t('settings.pricing.modelName')} style={{ fontFamily: 'monospace', flex: 1 }}
                  onChange={(e) => { const m = [...modelPricing]; m[idx] = { ...m[idx], model: e.currentTarget.value }; setModelPricing(m); }} />
                <ActionIcon color="red" variant="subtle" onClick={() => setModelPricing(modelPricing.filter((_, i) => i !== idx))}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                <NumberInput size="xs" label={t('settings.pricing.input')} value={mp.input} decimalScale={2} step={0.5}
                  onChange={(v) => { const m = [...modelPricing]; m[idx] = { ...m[idx], input: Number(v) || 0 }; setModelPricing(m); }} />
                <NumberInput size="xs" label={t('settings.pricing.output')} value={mp.output} decimalScale={2} step={0.5}
                  onChange={(v) => { const m = [...modelPricing]; m[idx] = { ...m[idx], output: Number(v) || 0 }; setModelPricing(m); }} />
                <NumberInput size="xs" label={t('settings.pricing.cacheWriteShort')} value={mp.cache_write} decimalScale={2} step={0.5}
                  onChange={(v) => { const m = [...modelPricing]; m[idx] = { ...m[idx], cache_write: Number(v) || 0 }; setModelPricing(m); }} />
                <NumberInput size="xs" label={t('settings.pricing.cacheReadShort')} value={mp.cache_read} decimalScale={2} step={0.01}
                  onChange={(v) => { const m = [...modelPricing]; m[idx] = { ...m[idx], cache_read: Number(v) || 0 }; setModelPricing(m); }} />
              </SimpleGrid>
            </Card>
          ))}
        </Stack>
        <Button variant="light" size="xs" mt="sm" leftSection={<IconPlus size={14} />}
          onClick={() => setModelPricing([...modelPricing, { model: '', input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 }])}>
          {t('settings.pricing.addModel')}
        </Button>
      </Card>

      {/* Config File Preview */}
      <Card withBorder>
        <Title order={5} mb="md">📄 {t('settings.rawConfig.title')}</Title>
        <Text size="sm" c="dimmed" mb="md">
          {t('settings.rawConfig.description')}
        </Text>
      </Card>
    </Stack>
  );
};
