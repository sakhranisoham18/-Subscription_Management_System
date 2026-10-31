import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, MoreHorizontal, Plus, Power, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAction, useListState, usePaged } from '@/lib/hooks';
import { titleCase } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, Checkbox, Field, Input, Select } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem } from '@/components/ui/menu';
import { Pagination, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { FilterSelect, ListToolbar } from '@/components/ListToolbar';
import { passwordSchema } from '../auth/AuthLayout';

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'STAFF';
  status: 'ACTIVE' | 'INACTIVE';
  phone: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter a name'),
    email: z.string().trim().email('Enter a valid email'),
    role: z.enum(['ADMIN', 'STAFF']),
    phone: z.string().optional(),
    sendInvite: z.boolean(),
    password: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.sendInvite) {
      const r = passwordSchema.safeParse(v.password ?? '');
      if (!r.success) ctx.addIssue({ code: 'custom', path: ['password'], message: r.error.issues[0].message });
    }
  });

export default function Staff() {
  const { user } = useAuth();
  const list = useListState({ sort: 'createdAt' });
  const { data, isLoading, error, refetch } = usePaged<StaffUser>('users', '/users', list.query);
  const [creating, setCreating] = useState(false);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (creating) form.reset({ name: '', email: '', role: 'STAFF', phone: '', sendInvite: true, password: '' });
  }, [creating, form]);
  const create = useAction((v: z.infer<typeof schema>) => api.post<{ warning?: string }>('/users', { ...v, password: v.sendInvite ? undefined : v.password }), {
    success: 'Staff account created',
    invalidate: [['users']],
    onSuccess: (r) => { setCreating(false); if (r.warning) toast.warning(r.warning, { duration: 10000 }); },
  });
  const update = useAction(({ id, ...body }: { id: string; status?: string; role?: string }) => api.patch(`/users/${id}`, body), { success: 'Account updated', invalidate: [['users']] });
  const reset = useAction((id: string) => api.post(`/users/${id}/send-reset`), { success: 'Password reset link sent' });
  const sendInvite = form.watch('sendInvite');

  return (
    <>
      <PageHeader
        title="Staff"
        description="Only the admin can add, change or deactivate internal accounts."
        actions={<Button onClick={() => setCreating(true)}><Plus /> Add staff member</Button>}
      />
      <Card>
        <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Search name or email">
          <FilterSelect label="Role" value={list.filters.role} onChange={(v) => list.setFilter('role', v)} options={[['ADMIN', 'Admin'], ['STAFF', 'Staff']]} />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={[['ACTIVE', 'Active'], ['INACTIVE', 'Inactive']]} />
        </ListToolbar>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead><Tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th className="w-10" /></Tr></THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={6} /> : data?.data.map((u) => (
                  <Tr key={u.id}>
                    <Td className="font-medium">{u.name}{u.id === user?.id && <Badge className="ml-2">You</Badge>}</Td>
                    <Td className="text-ink-soft">{u.email}</Td>
                    <Td><Badge tone={u.role === 'ADMIN' ? 'indigo' : 'gray'}>{titleCase(u.role)}</Badge></Td>
                    <Td><StatusBadge status={u.status} /></Td>
                    <Td className="text-ink-soft">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</Td>
                    <Td>
                      {u.id !== user?.id && (
                        <Menu trigger={<Button variant="ghost" size="icon" aria-label={`Actions for ${u.name}`}><MoreHorizontal /></Button>}>
                          <MenuItem onSelect={() => update.mutate({ id: u.id, role: u.role === 'ADMIN' ? 'STAFF' : 'ADMIN' })}><ShieldCheck /> Make {u.role === 'ADMIN' ? 'staff' : 'admin'}</MenuItem>
                          <MenuItem onSelect={() => reset.mutate(u.id)} disabled={u.status !== 'ACTIVE'}><KeyRound /> Send password reset</MenuItem>
                          <MenuItem danger={u.status === 'ACTIVE'} onSelect={() => update.mutate({ id: u.id, status: u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}><Power /> {u.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</MenuItem>
                        </Menu>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && <EmptyState icon={ShieldCheck} title="No staff found" />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Add staff member"
        footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button loading={create.isPending} onClick={form.handleSubmit((v) => create.mutateAsync(v).catch((e) => { if (e instanceof ApiError && e.fields) for (const [k, m] of Object.entries(e.fields)) form.setError(k as 'email', { message: m }); }))}>Create account</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={form.formState.errors.name?.message}>{(p) => <Input {...p} {...form.register('name')} />}</Field>
          <Field label="Email" required error={form.formState.errors.email?.message}>{(p) => <Input {...p} type="email" {...form.register('email')} />}</Field>
          <Field label="Role">{(p) => <Select {...p} {...form.register('role')}><option value="STAFF">Internal staff — limited access</option><option value="ADMIN">Admin — full access</option></Select>}</Field>
          <Field label="Phone">{(p) => <Input {...p} {...form.register('phone')} />}</Field>
          <Checkbox className="sm:col-span-2" label="Email an invitation link" description="They choose their own password (link valid 3 days)." {...form.register('sendInvite')} />
          {!sendInvite && <Field label="Initial password" required error={form.formState.errors.password?.message} className="sm:col-span-2">{(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}</Field>}
        </div>
      </Dialog>
    </>
  );
}
