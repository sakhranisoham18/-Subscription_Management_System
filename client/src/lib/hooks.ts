import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage, type Paged } from './api';

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * List state (page, search, sort, filters) kept in the URL so lists are shareable and survive refresh.
 */
export function useListState(defaults: { sort?: string; order?: 'asc' | 'desc'; pageSize?: number } = {}) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);

  const set = useCallback(
    (patch: Record<string, string | number | undefined | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  useEffect(() => {
    if ((params.get('search') ?? '') !== debounced) set({ search: debounced, page: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const page = Number(params.get('page') ?? 1);
  const sort = params.get('sort') ?? defaults.sort;
  const order = (params.get('order') as 'asc' | 'desc') ?? defaults.order ?? 'desc';
  const filters = useMemo(() => Object.fromEntries([...params.entries()].filter(([k]) => !['page', 'search', 'sort', 'order'].includes(k))), [params]);

  return {
    search,
    setSearch,
    page,
    setPage: (p: number) => set({ page: p === 1 ? undefined : p }),
    sort,
    order,
    onSort: (field: string) => set({ sort: field, order: sort === field && order === 'desc' ? 'asc' : 'desc', page: undefined }),
    filters,
    setFilter: (key: string, value: string | undefined) => set({ [key]: value, page: undefined }),
    query: { page, pageSize: defaults.pageSize ?? 20, search: debounced || undefined, sort, order, ...filters },
  };
}

export function usePaged<T>(key: string, path: string, query: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: [key, query],
    queryFn: () => api.get<Paged<T>>(path, query as Record<string, string>),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Mutation with success toast, error toast and cache invalidation. */
export function useAction<TVars = void, TRes = unknown>(
  fn: (vars: TVars) => Promise<TRes>,
  opts: { success?: string | ((res: TRes) => string); invalidate?: QueryKey[]; onSuccess?: (res: TRes) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (res) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(res) : opts.success);
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
      opts.onSuccess?.(res);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Lightweight option lists for selects. */
export function useOptions<T>(key: string, path: string, query: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: ['options', key, query],
    queryFn: () => api.get<{ data: T[] }>(path, { pageSize: 100, ...query } as unknown as Record<string, string>),
    staleTime: 60_000,
  });
}
