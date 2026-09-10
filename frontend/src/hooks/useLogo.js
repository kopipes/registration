import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

export function useLogo() {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
    staleTime: 60_000,
  })
  return data?.logo_url || null
}
