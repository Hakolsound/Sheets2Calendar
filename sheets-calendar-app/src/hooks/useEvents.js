import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFunctions, httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';

export const useEvents = (timeframe = 'today') => {
  return useQuery({
    queryKey: ['events', timeframe],
    queryFn: async () => {
      const functions = getFunctions(undefined, 'us-central1');
      const getTimeframeEvents = httpsCallable(functions, 'getTimeframeEvents');
      const result = await getTimeframeEvents({ timeframe });

      if (!result.data.success) {
        throw new Error(result.data.error || 'Failed to fetch events');
      }

      return result.data.events || [];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    cacheTime: 1000 * 60 * 10, // 10 minutes
    refetchOnWindowFocus: true,
    onError: (error) => {
      toast.error(`Failed to load events: ${error.message}`);
    },
  });
};

export const useManualScan = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fullScan = false) => {
      // Use the global functions instance from window (initialized in App.jsx)
      const functions = window.functions;
      const scanFunction = httpsCallable(
        functions,
        fullScan ? 'scanAllRowsForUpdates' : 'manualScan'
      );
      const result = await scanFunction();

      if (!result.data.success) {
        throw new Error(result.data.error || 'Scan failed');
      }

      return result.data;
    },
    onSuccess: (data) => {
      // Invalidate all event queries to refetch
      queryClient.invalidateQueries({ queryKey: ['events'] });

      toast.success(
        `Scan complete! ${data.stats?.processed || 0} events processed`,
        { duration: 5000 }
      );
    },
    onError: (error) => {
      toast.error(`Scan failed: ${error.message}`);
    },
  });
};

export const useDeleteEvents = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ month, year }) => {
      const functions = getFunctions(undefined, 'us-central1');
      const deleteEventsInMonth = httpsCallable(functions, 'deleteEventsInMonth');
      const result = await deleteEventsInMonth({ month, year });

      if (!result.data.success) {
        throw new Error(result.data.error || 'Delete failed');
      }

      return result.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.success(
        `Deleted ${data.deletedCount || 0} events from ${variables.month}/${variables.year}`
      );
    },
    onError: (error) => {
      toast.error(`Delete failed: ${error.message}`);
    },
  });
};

export const useReprocessSelectedRows = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ rowIndices }) => {
      const functions = window.functions;
      const reprocessSelectedRows = httpsCallable(functions, 'reprocessSelectedRows');
      const result = await reprocessSelectedRows({ rowIndices });

      if (!result.data.success) {
        throw new Error(result.data.error || 'Reprocess failed');
      }

      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.success(
        `Added ${data.stats.processed} events to calendar (${data.stats.skipped} skipped)`
      );
    },
    onError: (error) => {
      toast.error(`Failed to add events: ${error.message}`);
    },
  });
};

export const useScanMonthEvents = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ month, year }) => {
      const functions = window.functions;
      const scanMonthEvents = httpsCallable(functions, 'scanMonthEvents');
      const result = await scanMonthEvents({ month, year });

      if (!result.data.success) {
        throw new Error(result.data.error || 'Scan failed');
      }

      return result.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.success(
        `Scanned ${variables.month}/${variables.year}: ${data.stats.processed} events added`
      );
    },
    onError: (error) => {
      toast.error(`Scan failed: ${error.message}`);
    },
  });
};

export const useDeleteSelectedEvents = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ rowIndices }) => {
      const functions = window.functions;
      const deleteSelectedEvents = httpsCallable(functions, 'deleteSelectedEvents');
      const result = await deleteSelectedEvents({ rowIndices });

      if (!result.data.success) {
        throw new Error(result.data.error || 'Delete failed');
      }

      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.success(
        `Deleted ${data.stats.deleted} events`
      );
    },
    onError: (error) => {
      toast.error(`Delete failed: ${error.message}`);
    },
  });
};
