import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Container,
  Paper,
  Tabs,
  Tab,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  Grid,
  Alert,
  CircularProgress,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Switch,
  FormControlLabel,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Checkbox,
  ButtonGroup,
  InputAdornment,
  Tooltip,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  PlayArrow as PlayIcon,
  Visibility as VisibilityIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  CalendarToday as CalendarTodayIcon,
  Timeline as TimelineIcon,
  Sync as SyncIcon,
  CloudUpload as CloudUploadIcon,
  CalendarMonth as CalendarMonthIcon,
  Search as SearchIcon,
  FilterList as FilterListIcon,
  DeleteSweep as DeleteSweepIcon,
  CheckBox as CheckBoxIcon,
  CheckBoxOutlineBlank as CheckBoxOutlineBlankIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import useAuthStore from '../store/authStore';
import { useManualScan, useDeleteEvents, useReprocessSelectedRows } from '../hooks/useEvents';
import toast from 'react-hot-toast';
import AuthorizeApis from './AuthorizeApis';

function TabPanel({ children, value, index, ...other }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`control-tabpanel-${index}`}
      aria-labelledby={`control-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

function ControlCenterEnhanced() {
  const { user } = useAuthStore();
  const [currentTab, setCurrentTab] = useState(1); // Start on Control tab
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);

  // Mutations
  const manualScanMutation = useManualScan();
  const deleteEventsMutation = useDeleteEvents();
  const reprocessMutation = useReprocessSelectedRows();

  // Month selector
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // Fixed values
  const FIXED_SPREADSHEET_ID = "1p3XgwnFOb6lxaAo0ysZH-prVNggOgksH-FE8clEoO1U";
  const FIXED_SHEET_NAME = "This Year";
  const FIXED_DATA_RANGE = "A2:AZ";

  const [config, setConfig] = useState({
    enabled: false,
    spreadsheetId: FIXED_SPREADSHEET_ID,
    sheetName: FIXED_SHEET_NAME,
    dataRange: FIXED_DATA_RANGE,
    calendarId: '',
    processedColumnIndex: 36,
    processedMarker: 'PROCESSED',
    updateProcessedStatus: true,
    timezone: 'Asia/Jerusalem',
  });

  // Events for selected month
  const [monthEvents, setMonthEvents] = useState([]);
  const [fetchingEvents, setFetchingEvents] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState(new Set());
  const [filterText, setFilterText] = useState('');

  // Preview data
  const [previewData, setPreviewData] = useState([]);
  const [fetchingPreview, setFetchingPreview] = useState(false);

  // Logs
  const [logs, setLogs] = useState([]);
  const [fetchingLogs, setFetchingLogs] = useState(false);

  // Progress tracking
  const [progressDialog, setProgressDialog] = useState({
    open: false,
    title: '',
    message: '',
    progress: 0,
    steps: []
  });

  const db = getFirestore();
  const functions = getFunctions(undefined, 'us-central1');

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Load configuration and credentials on mount
  useEffect(() => {
    fetchConfiguration();
    checkCredentials();
  }, [user?.uid]);

  // Auto-load events when month/year changes or tab switches to Control
  useEffect(() => {
    if (currentTab === 1 && hasCredentials && !loading) {
      fetchMonthEvents();
    }
  }, [selectedMonth, selectedYear, currentTab, hasCredentials, loading]);

  const checkCredentials = async () => {
    try {
      const credentialsDocRef = doc(db, 'userCredentials', user.uid);
      const credentialsDoc = await getDoc(credentialsDocRef);
      setHasCredentials(credentialsDoc.exists());
    } catch (error) {
      console.error('Error checking credentials:', error);
    }
  };

  const fetchConfiguration = async () => {
    try {
      setLoading(true);
      const configDocRef = doc(db, 'configurations', user.uid);
      const configDoc = await getDoc(configDocRef);

      if (configDoc.exists()) {
        const savedConfig = configDoc.data();
        setConfig(prevConfig => ({
          ...prevConfig,
          ...savedConfig,
          spreadsheetId: FIXED_SPREADSHEET_ID,
          sheetName: FIXED_SHEET_NAME,
          dataRange: FIXED_DATA_RANGE
        }));
      }
    } catch (error) {
      console.error('Error fetching configuration:', error);
      toast.error('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const saveConfiguration = async () => {
    try {
      setSaving(true);
      const configDocRef = doc(db, 'configurations', user.uid);
      await setDoc(configDocRef, config);
      toast.success('Configuration saved successfully!');
    } catch (error) {
      console.error('Error saving configuration:', error);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const fetchMonthEvents = async () => {
    setFetchingEvents(true);
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const getMonthEvents = httpsCallable(functions, 'getTimeframeEvents');

      console.log('Fetching events for:', { month: selectedMonth, year: selectedYear });

      // Use 'month' as timeframe and pass the specific month/year
      const result = await getMonthEvents({
        timeframe: 'month',
        month: selectedMonth,
        year: selectedYear
      });

      console.log('Month events result:', result);
      console.log('Result data:', result.data);

      if (result.data && result.data.success) {
        const events = result.data.events || [];
        console.log(`Loaded ${events.length} events from backend for ${months[selectedMonth - 1]} ${selectedYear}`);

        // Backend now returns pre-filtered events for the requested month/year
        // No need for client-side filtering anymore
        setMonthEvents(events);
        setSelectedEvents(new Set());

        if (events.length === 0) {
          toast(`No events found for ${months[selectedMonth - 1]} ${selectedYear}`, { icon: 'ℹ️' });
        } else {
          toast.success(`Loaded ${events.length} events`);
        }
      } else {
        console.error('Failed to fetch events:', result.data);
        toast.error(result.data?.error || result.data?.message || 'Failed to fetch events');
        setMonthEvents([]);
      }
    } catch (error) {
      console.error('Error fetching month events:', error);
      toast.error(`Failed to fetch month events: ${error.message}`);
      setMonthEvents([]);
    } finally {
      setFetchingEvents(false);
    }
  };

  const fetchPreviewData = async () => {
    setFetchingPreview(true);
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const getPreviewFn = httpsCallable(functions, 'getSheetPreview');
      const result = await getPreviewFn();

      console.log('Preview result:', result);

      if (result.data && result.data.success) {
        const preview = result.data.preview || result.data.data || [];
        console.log('Preview data:', preview);
        setPreviewData(Array.isArray(preview) ? preview : []);
      } else {
        console.error('Preview fetch failed:', result.data);
        toast.error(result.data?.error || 'Failed to fetch preview');
        setPreviewData([]);
      }
    } catch (error) {
      console.error('Error fetching preview:', error);
      toast.error(`Failed to fetch sheet preview: ${error.message}`);
      setPreviewData([]);
    } finally {
      setFetchingPreview(false);
    }
  };

  const fetchLogs = async () => {
    setFetchingLogs(true);
    try {
      const getLogsFn = httpsCallable(functions, 'getLogs');
      const result = await getLogsFn({ limit: 50 });

      if (result.data.success) {
        setLogs(result.data.logs || []);
      } else {
        toast.error(result.data.error || 'Failed to fetch logs');
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
      toast.error('Failed to fetch logs');
    } finally {
      setFetchingLogs(false);
    }
  };

  const handleTabChange = (event, newValue) => {
    setCurrentTab(newValue);

    if (newValue === 1) { // Control tab
      fetchMonthEvents();
    } else if (newValue === 2) { // Monitor tab
      fetchLogs();
    } else if (newValue === 3) { // Preview tab
      fetchPreviewData();
    }
  };

  const handleManualScan = (fullScan = false) => {
    const scanType = fullScan ? 'Full Scan' : 'Quick Scan';

    // Show progress dialog
    setProgressDialog({
      open: true,
      title: scanType,
      message: 'Initializing scan...',
      progress: 0,
      steps: [
        'Connecting to Google Sheets',
        'Reading spreadsheet data',
        'Processing events',
        'Updating calendar',
        'Finalizing'
      ]
    });

    manualScanMutation.mutate(fullScan, {
      onSuccess: (data) => {
        // Update progress to completion
        setProgressDialog(prev => ({
          ...prev,
          progress: 100,
          message: `Scan complete! Processed ${data.stats?.processed || 0} events`
        }));

        // Close dialog after delay
        setTimeout(() => {
          setProgressDialog(prev => ({ ...prev, open: false }));
          // Refresh month events after scan
          fetchMonthEvents();
        }, 2000);
      },
      onError: (error) => {
        setProgressDialog(prev => ({
          ...prev,
          open: false
        }));
      }
    });

    // Simulate progress updates (since we don't have real-time progress from backend)
    const progressInterval = setInterval(() => {
      setProgressDialog(prev => {
        if (!prev.open || prev.progress >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return {
          ...prev,
          progress: Math.min(prev.progress + 10, 90),
          message: prev.steps[Math.floor(prev.progress / 20)] || 'Processing...'
        };
      });
    }, 800);
  };

  const handleScanThisMonth = () => {
    const monthName = months[selectedMonth - 1];

    // Show progress dialog
    setProgressDialog({
      open: true,
      title: `Scan ${monthName} ${selectedYear}`,
      message: 'Starting month-specific scan...',
      progress: 0,
      steps: [
        'Filtering month data',
        'Processing events',
        'Updating calendar',
        'Complete'
      ]
    });

    // Use quick scan to avoid timeouts (processes new/unprocessed rows only)
    manualScanMutation.mutate(false, {
      onSuccess: (data) => {
        setProgressDialog(prev => ({
          ...prev,
          progress: 100,
          message: `Month scan complete! ${monthEvents.length} events in ${monthName}`
        }));

        setTimeout(() => {
          setProgressDialog(prev => ({ ...prev, open: false }));
          fetchMonthEvents();
        }, 2000);
      },
      onError: () => {
        setProgressDialog(prev => ({ ...prev, open: false }));
      }
    });

    // Simulate progress
    const progressInterval = setInterval(() => {
      setProgressDialog(prev => {
        if (!prev.open || prev.progress >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return {
          ...prev,
          progress: Math.min(prev.progress + 15, 90),
          message: prev.steps[Math.floor(prev.progress / 25)] || 'Processing...'
        };
      });
    }, 600);
  };

  const handleDeleteMonth = () => {
    const monthName = months[selectedMonth - 1];
    if (window.confirm(`Are you sure you want to delete ALL events from ${monthName} ${selectedYear}?`)) {
      // Show progress dialog
      setProgressDialog({
        open: true,
        title: 'Deleting Events',
        message: `Removing events from ${monthName} ${selectedYear}...`,
        progress: 0,
        steps: ['Connecting to calendar', 'Finding events', 'Deleting events', 'Complete']
      });

      deleteEventsMutation.mutate(
        { month: selectedMonth, year: selectedYear },
        {
          onSuccess: (data) => {
            setProgressDialog(prev => ({
              ...prev,
              progress: 100,
              message: `Deleted ${data.deletedCount || monthEvents.length} events`
            }));

            setTimeout(() => {
              setProgressDialog(prev => ({ ...prev, open: false }));
              fetchMonthEvents();
            }, 2000);
          },
          onError: () => {
            setProgressDialog(prev => ({ ...prev, open: false }));
          }
        }
      );

      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgressDialog(prev => {
          if (!prev.open || prev.progress >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return {
            ...prev,
            progress: Math.min(prev.progress + 20, 90),
            message: prev.steps[Math.floor(prev.progress / 25)] || 'Processing...'
          };
        });
      }, 500);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedEvents.size === 0) {
      toast.error('No events selected');
      return;
    }

    if (window.confirm(`Delete ${selectedEvents.size} selected event(s)?`)) {
      // TODO: Implement selective delete
      toast('Selective delete will be implemented soon', { icon: 'ℹ️' });
    }
  };

  const handleAddSelectedToCalendar = () => {
    console.log('handleAddSelectedToCalendar called with', selectedEvents.size, 'events');
    if (selectedEvents.size === 0) {
      toast.error('No events selected');
      return;
    }

    const monthName = months[selectedMonth - 1];

    // Get the full event data from selected events
    const eventsToAdd = Array.from(selectedEvents).map(index => monthEvents[index]);

    console.log('Events to reprocess:', eventsToAdd);

    // Show progress dialog
    setProgressDialog({
      open: true,
      title: 'Adding Events to Calendar',
      message: `Processing ${selectedEvents.size} selected events...`,
      progress: 0,
      steps: [
        'Reading sheet data',
        'Processing events',
        'Adding to calendar',
        'Complete'
      ]
    });

    // Use the new reprocess mutation with specific row indices
    reprocessMutation.mutate({ rowIndices }, {
      onSuccess: (data) => {
        setProgressDialog(prev => ({
          ...prev,
          progress: 100,
          message: `Added ${data.stats.processed} events to calendar successfully!`
        }));

        setTimeout(() => {
          setProgressDialog(prev => ({ ...prev, open: false }));
          fetchMonthEvents();
          setSelectedEvents(new Set()); // Clear selection
        }, 2000);
      },
      onError: () => {
        setProgressDialog(prev => ({ ...prev, open: false }));
      }
    });

    // Simulate progress
    const progressInterval = setInterval(() => {
      setProgressDialog(prev => {
        if (!prev.open || prev.progress >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return {
          ...prev,
          progress: Math.min(prev.progress + 15, 90),
          message: prev.steps[Math.floor(prev.progress / 25)] || 'Processing...'
        };
      });
    }, 600);
  };

  const handleSelectAll = () => {
    if (selectedEvents.size === filteredEvents.length) {
      setSelectedEvents(new Set());
    } else {
      setSelectedEvents(new Set(filteredEvents.map((_, idx) => idx)));
    }
  };

  const toggleEventSelection = (index) => {
    const newSelected = new Set(selectedEvents);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedEvents(newSelected);
  };

  // Filtered events based on search
  const filteredEvents = useMemo(() => {
    if (!filterText) return monthEvents;

    const lowerFilter = filterText.toLowerCase();
    return monthEvents.filter(event =>
      (event.title && event.title.toLowerCase().includes(lowerFilter)) ||
      (event.eventType && event.eventType.toLowerCase().includes(lowerFilter)) ||
      (event.location && event.location.toLowerCase().includes(lowerFilter)) ||
      (event.manager && event.manager.toLowerCase().includes(lowerFilter))
    );
  }, [monthEvents, filterText]);

  const getLogIcon = (type) => {
    switch (type) {
      case 'success': return <CheckCircleIcon color="success" />;
      case 'error': return <ErrorIcon color="error" />;
      default: return <InfoIcon color="info" />;
    }
  };

  const getEventTypeColor = (eventType) => {
    const colors = {
      'סטנדאפ': '#E6D4F0',
      'מצלמות': '#FFF2CC',
      'כנס': '#F8CEBD',
      'אולפן': '#E2F0D9',
      'שטח': '#5C3317',
      'חו"ל': '#FADBD8',
    };
    return colors[eventType] || '#607D8B';
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 'bold' }}>
          Control Center
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your Sheets-to-Calendar synchronization
        </Typography>
      </Box>

      {!hasCredentials && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            API Authorization Required
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            You need to authorize Google Sheets and Calendar APIs before using this app.
          </Typography>
          <AuthorizeApis onSuccess={checkCredentials} />
        </Alert>
      )}

      <Paper elevation={2}>
        <Tabs
          value={currentTab}
          onChange={handleTabChange}
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            px: 2,
          }}
        >
          <Tab icon={<SettingsIcon />} label="Setup" iconPosition="start" />
          <Tab icon={<CalendarMonthIcon />} label="Control & Preview" iconPosition="start" />
          <Tab icon={<TimelineIcon />} label="Monitor" iconPosition="start" />
          <Tab icon={<EditIcon />} label="Sheet Preview" iconPosition="start" />
        </Tabs>

        {/* SETUP TAB */}
        <TabPanel value={currentTab} index={0}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                    <CloudUploadIcon color="primary" />
                    <Typography variant="h6">Spreadsheet Configuration</Typography>
                  </Stack>
                  <Divider sx={{ mb: 2 }} />

                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        label="Spreadsheet ID"
                        value={config.spreadsheetId}
                        disabled
                        helperText="Fixed spreadsheet for this organization"
                        variant="outlined"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Sheet Name"
                        value={config.sheetName}
                        disabled
                        variant="outlined"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Data Range"
                        value={config.dataRange}
                        disabled
                        variant="outlined"
                      />
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                    <SettingsIcon color="primary" />
                    <Typography variant="h6">Calendar Settings</Typography>
                  </Stack>
                  <Divider sx={{ mb: 2 }} />

                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        label="Calendar ID"
                        value={config.calendarId}
                        onChange={(e) => setConfig({ ...config, calendarId: e.target.value })}
                        placeholder="your-calendar@group.calendar.google.com"
                        helperText="The Google Calendar ID where events will be created"
                        variant="outlined"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Timezone"
                        value={config.timezone}
                        onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
                        variant="outlined"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Processed Column Index"
                        type="number"
                        value={config.processedColumnIndex}
                        onChange={(e) => setConfig({ ...config, processedColumnIndex: parseInt(e.target.value) })}
                        helperText="Column where processed status is marked (36 = AK)"
                        variant="outlined"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Processed Marker"
                        value={config.processedMarker}
                        onChange={(e) => setConfig({ ...config, processedMarker: e.target.value })}
                        helperText="Text to mark processed rows"
                        variant="outlined"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={config.enabled}
                            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                          />
                        }
                        label="Enable Automatic Sync"
                      />
                    </Grid>
                  </Grid>

                  <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
                    <Button
                      variant="contained"
                      startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
                      onClick={saveConfiguration}
                      disabled={saving || !hasCredentials}
                    >
                      Save Configuration
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Status
                  </Typography>
                  <Divider sx={{ mb: 2 }} />

                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={3}>
                      <Chip
                        label={config.enabled ? "Auto-Sync Enabled" : "Auto-Sync Disabled"}
                        color={config.enabled ? "success" : "default"}
                        sx={{ width: '100%' }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Chip
                        label={hasCredentials ? "Authorized" : "Not Authorized"}
                        color={hasCredentials ? "success" : "error"}
                        sx={{ width: '100%' }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Chip
                        label={config.calendarId ? "Calendar Configured" : "No Calendar"}
                        color={config.calendarId ? "success" : "warning"}
                        sx={{ width: '100%' }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Chip
                        label="Sync: Every 30min"
                        color="info"
                        sx={{ width: '100%' }}
                      />
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </TabPanel>

        {/* CONTROL & PREVIEW TAB */}
        <TabPanel value={currentTab} index={1}>
          <Grid container spacing={3}>
            {/* Month Selector */}
            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center" justifyContent="center">
                    <IconButton
                      color="primary"
                      onClick={() => {
                        if (selectedMonth === 12) {
                          setSelectedMonth(1);
                          setSelectedYear(selectedYear + 1);
                        } else {
                          setSelectedMonth(selectedMonth + 1);
                        }
                      }}
                      size="large"
                    >
                      <ChevronLeftIcon />
                    </IconButton>

                    <Stack direction="row" spacing={2} alignItems="center" sx={{ minWidth: 300, justifyContent: 'center' }}>
                      <CalendarMonthIcon color="primary" fontSize="large" />
                      <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h5" fontWeight="bold">
                          {months[selectedMonth - 1]} {selectedYear}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {fetchingEvents ? 'Loading events...' : `${monthEvents.length} events`}
                        </Typography>
                      </Box>
                    </Stack>

                    <IconButton
                      color="primary"
                      onClick={() => {
                        if (selectedMonth === 1) {
                          setSelectedMonth(12);
                          setSelectedYear(selectedYear - 1);
                        } else {
                          setSelectedMonth(selectedMonth - 1);
                        }
                      }}
                      size="large"
                    >
                      <ChevronRightIcon />
                    </IconButton>

                    <Divider orientation="vertical" flexItem sx={{ mx: 2 }} />

                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        const now = new Date();
                        setSelectedMonth(now.getMonth() + 1);
                        setSelectedYear(now.getFullYear());
                      }}
                    >
                      Today
                    </Button>

                    <IconButton
                      color="primary"
                      onClick={fetchMonthEvents}
                      disabled={fetchingEvents || !hasCredentials}
                      title="Refresh"
                    >
                      {fetchingEvents ? <CircularProgress size={24} /> : <RefreshIcon />}
                    </IconButton>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            {/* Operations */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                    <SyncIcon color="primary" />
                    <Typography variant="h6">Synchronization</Typography>
                  </Stack>
                  <Divider sx={{ mb: 2 }} />

                  <Stack spacing={2}>
                    <Button
                      variant="contained"
                      color="success"
                      size="large"
                      startIcon={manualScanMutation.isLoading ? <CircularProgress size={20} /> : <CalendarTodayIcon />}
                      onClick={handleScanThisMonth}
                      disabled={manualScanMutation.isLoading || !hasCredentials}
                      fullWidth
                      sx={{ py: 1.5 }}
                    >
                      Scan {months[selectedMonth - 1]} {selectedYear}
                    </Button>

                    <Divider>OR</Divider>

                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={manualScanMutation.isLoading ? <CircularProgress size={20} /> : <PlayIcon />}
                      onClick={() => handleManualScan(false)}
                      disabled={manualScanMutation.isLoading || !hasCredentials}
                      fullWidth
                    >
                      Quick Scan (New Rows)
                    </Button>

                    <Button
                      variant="outlined"
                      color="primary"
                      startIcon={manualScanMutation.isLoading ? <CircularProgress size={20} /> : <RefreshIcon />}
                      onClick={() => handleManualScan(true)}
                      disabled={manualScanMutation.isLoading || !hasCredentials}
                      fullWidth
                    >
                      Full Scan (All Rows)
                    </Button>
                  </Stack>

                  {manualScanMutation.data && (
                    <Alert severity="success" sx={{ mt: 2 }}>
                      <Typography variant="body2">
                        Processed: {manualScanMutation.data.stats?.processed || 0} events
                      </Typography>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                    <DeleteIcon color="error" />
                    <Typography variant="h6">Delete from Calendar</Typography>
                  </Stack>
                  <Divider sx={{ mb: 2 }} />

                  <Stack spacing={2}>
                    <Button
                      variant="contained"
                      color="error"
                      startIcon={deleteEventsMutation.isLoading ? <CircularProgress size={20} /> : <DeleteSweepIcon />}
                      onClick={handleDeleteMonth}
                      disabled={deleteEventsMutation.isLoading || !hasCredentials || monthEvents.length === 0}
                      fullWidth
                    >
                      Delete All ({monthEvents.length} events)
                    </Button>

                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteIcon />}
                      onClick={handleDeleteSelected}
                      disabled={selectedEvents.size === 0}
                      fullWidth
                    >
                      Delete Selected ({selectedEvents.size})
                    </Button>

                    <Divider sx={{ my: 1 }} />

                    <Button
                      variant="contained"
                      color="success"
                      startIcon={manualScanMutation.isLoading ? <CircularProgress size={20} /> : <PlayIcon />}
                      onClick={handleAddSelectedToCalendar}
                      disabled={selectedEvents.size === 0 || manualScanMutation.isLoading || !hasCredentials}
                      fullWidth
                    >
                      Add Selected to Calendar ({selectedEvents.size})
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            {/* Events Preview */}
            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                    <VisibilityIcon color="primary" />
                    <Typography variant="h6" sx={{ flexGrow: 1 }}>
                      Events for {months[selectedMonth - 1]} {selectedYear}
                    </Typography>
                    <TextField
                      size="small"
                      placeholder="Search events..."
                      value={filterText}
                      onChange={(e) => setFilterText(e.target.value)}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon />
                          </InputAdornment>
                        ),
                      }}
                      sx={{ minWidth: 250 }}
                    />
                    <Chip
                      label={`${filteredEvents.length} events`}
                      color="primary"
                      variant="outlined"
                    />
                  </Stack>
                  <Divider sx={{ mb: 2 }} />

                  {fetchingEvents ? (
                    <Box display="flex" justifyContent="center" py={4}>
                      <CircularProgress />
                    </Box>
                  ) : filteredEvents.length === 0 ? (
                    <Alert severity="info">
                      No events found for this month. Click "Load Events" to fetch data.
                    </Alert>
                  ) : (
                    <>
                      <Box sx={{ mb: 2 }}>
                        <Button
                          size="small"
                          startIcon={
                            selectedEvents.size === filteredEvents.length ?
                              <CheckBoxIcon /> :
                              <CheckBoxOutlineBlankIcon />
                          }
                          onClick={handleSelectAll}
                        >
                          {selectedEvents.size === filteredEvents.length ? 'Deselect All' : 'Select All'}
                        </Button>
                      </Box>

                      <TableContainer sx={{ maxHeight: 600 }}>
                        <Table stickyHeader size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell padding="checkbox">Select</TableCell>
                              <TableCell>Date</TableCell>
                              <TableCell>Time</TableCell>
                              <TableCell>Type</TableCell>
                              <TableCell>Title</TableCell>
                              <TableCell>Location</TableCell>
                              <TableCell>Manager</TableCell>
                              <TableCell>Technicians</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {filteredEvents.map((event, index) => (
                              <TableRow
                                key={index}
                                hover
                                selected={selectedEvents.has(index)}
                                onClick={() => toggleEventSelection(index)}
                                sx={{ cursor: 'pointer' }}
                              >
                                <TableCell padding="checkbox">
                                  <Checkbox checked={selectedEvents.has(index)} />
                                </TableCell>
                                <TableCell>{event.date || '-'}</TableCell>
                                <TableCell>{event.time || '-'}</TableCell>
                                <TableCell>
                                  <Chip
                                    label={event.eventTypeD || event.eventType || '-'}
                                    size="small"
                                    sx={{
                                      backgroundColor: getEventTypeColor(event.eventTypeD),
                                      color: '#000',
                                    }}
                                  />
                                </TableCell>
                                <TableCell>{event.title || '-'}</TableCell>
                                <TableCell>{event.location || '-'}</TableCell>
                                <TableCell>{event.manager || '-'}</TableCell>
                                <TableCell>
                                  {event.technicians && event.technicians.length > 0
                                    ? event.technicians.join(', ')
                                    : '-'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </TabPanel>

        {/* MONITOR TAB */}
        <TabPanel value={currentTab} index={2}>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Operation Logs</Typography>
            <Button
              startIcon={fetchingLogs ? <CircularProgress size={20} /> : <RefreshIcon />}
              onClick={fetchLogs}
              disabled={fetchingLogs}
            >
              Refresh Logs
            </Button>
          </Box>

          {logs.length === 0 ? (
            <Alert severity="info">No logs available</Alert>
          ) : (
            <List sx={{ maxHeight: 600, overflow: 'auto' }}>
              {logs.map((log, index) => (
                <React.Fragment key={log.id || index}>
                  <ListItem alignItems="flex-start">
                    <Box sx={{ mr: 2, mt: 0.5 }}>
                      {getLogIcon(log.type)}
                    </Box>
                    <ListItemText
                      primary={log.message}
                      secondary={
                        <>
                          <Typography component="span" variant="body2" color="text.secondary">
                            {log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleString() : 'Unknown time'}
                          </Typography>
                          {log.details && (
                            <Typography component="div" variant="body2" sx={{ mt: 0.5 }}>
                              {log.details}
                            </Typography>
                          )}
                        </>
                      }
                    />
                  </ListItem>
                  {index < logs.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          )}
        </TabPanel>

        {/* SHEET PREVIEW TAB */}
        <TabPanel value={currentTab} index={3}>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Spreadsheet Preview</Typography>
            <Button
              startIcon={fetchingPreview ? <CircularProgress size={20} /> : <RefreshIcon />}
              onClick={fetchPreviewData}
              disabled={fetchingPreview || !hasCredentials}
            >
              Load Preview
            </Button>
          </Box>

          {previewData.length === 0 ? (
            <Alert severity="info">Click "Load Preview" to see spreadsheet data</Alert>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 600 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Row</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Event Type</TableCell>
                    <TableCell>Title</TableCell>
                    <TableCell>Location</TableCell>
                    <TableCell>Manager</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {previewData.map((row, index) => (
                    <TableRow key={index} hover>
                      <TableCell>{row.rowNumber || index + 2}</TableCell>
                      <TableCell>{row.date || '-'}</TableCell>
                      <TableCell>{row.eventType || '-'}</TableCell>
                      <TableCell>{row.title || '-'}</TableCell>
                      <TableCell>{row.location || '-'}</TableCell>
                      <TableCell>{row.manager || '-'}</TableCell>
                      <TableCell>
                        {row.processed ? (
                          <Chip label="Processed" size="small" color="success" />
                        ) : (
                          <Chip label="Pending" size="small" color="default" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </TabPanel>
      </Paper>

      {/* Progress Dialog */}
      <Dialog
        open={progressDialog.open}
        maxWidth="sm"
        fullWidth
        disableEscapeKeyDown
      >
        <DialogTitle>{progressDialog.title}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {progressDialog.message}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={progressDialog.progress}
              sx={{ mt: 2, mb: 2, height: 8, borderRadius: 4 }}
            />
            <Typography variant="caption" color="text.secondary">
              {progressDialog.progress}% complete
            </Typography>

            {progressDialog.steps && progressDialog.steps.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Stepper activeStep={Math.floor(progressDialog.progress / (100 / progressDialog.steps.length))} orientation="vertical">
                  {progressDialog.steps.map((step, index) => (
                    <Step key={index}>
                      <StepLabel>{step}</StepLabel>
                    </Step>
                  ))}
                </Stepper>
              </Box>
            )}
          </Box>
        </DialogContent>
      </Dialog>
    </Container>
  );
}

export default ControlCenterEnhanced;
