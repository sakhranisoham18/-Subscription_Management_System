import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { titleCase } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Field, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/ui/feedback';
import { PasswordRules } from '../auth/AuthLayout';

export function ChangePasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useAction(() => api.post('/auth/change-password', { currentPassword: current, newPassword: next }), {
    success: 'Password updated',
    onSuccess: () => { setCurrent(''); setNext(''); },
  });
  return (
    <Card>
      <CardHeader title="Change password" />
      <CardBody className="space-y-4">
        <Field label="Current password">{(p) => <Input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
        <Field label="New password">{(p) => <Input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <PasswordRules value={next} />
        <Button loading={change.isPending} disabled={!current || next.length < 9} onClick={() => change.mutate()}>Update password</Button>
      </CardBody>
    </Card>
  );
}

export default function Profile() {
  const { user, refreshMe } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const save = useAction(() => api.patch('/auth/me', { name, phone: phone || null }), { success: 'Profile updated', onSuccess: () => refreshMe() });
  return (
    <>
      <PageHeader title="Your profile" description={<>{user?.email} · <Badge tone="indigo">{titleCase(user?.role)}</Badge></>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-4">
            <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Phone">{(p) => <Input {...p} value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
            <Field label="Email" hint="Ask an admin to change your email.">{(p) => <Input {...p} value={user?.email} disabled />}</Field>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </CardBody>
        </Card>
        <ChangePasswordCard />
      </div>
    </>
  );
}
