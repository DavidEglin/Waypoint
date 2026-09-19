import { useCallback, useEffect, useState } from 'react';
import type { ConnectionsResponse } from '@waypoint/shared';
import { api, errorMessage } from './api';

export function useConnections() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api<ConnectionsResponse>('GET', '/api/connections'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, reload, setData };
}
