import React, { useState, useEffect } from 'react';
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
  Timeline as TimelineIcon,
  Sync as SyncIcon,
  CloudUpload as CloudUploadIcon,
} from '@mui/icons-material';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import useAuthStore from '../store/authStore';
import { useManualScan, useDeleteEvents } from '../hooks/useEvents';
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

function ControlCenter() {
  const { user } = useAuthStore();
  const [currentTab, setCurrentTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);

  // Mutations
  const manualScanMutation = useManualScan();
  const deleteEventsMutation = useDeleteEvents();

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

  // Preview data
  const [previewData, setPreviewData] = useState([]);
  const [fetchingPreview, setFetchingPreview] = useState(false);

  // Logs
  const [logs, setLogs] = useState([]);
  const [fetchingLogs, setFetchingLogs] = useState(false);

  // Delete state
  const [deleteYear, setDeleteYear] = useState(new Date().getFullYear());
  const [deleteMonth, setDeleteMonth] = useState(new Date().getMonth() + 1);

  const db = getFirestore();
  const functions = getFunctions();

  // Load configuration and credentials on mount
  useEffect(() => {
    fetchConfiguration();
    checkCredentials();
  }, [user?.uid]);

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

  const fetchPreviewData = async () => {
    setFetchingPreview(true);
    try {
      const getPreviewFn = httpsCallable(functions, 'getSheetPreview');
      const result = await getPreviewFn();

      if (result.data.success) {
        setPreviewData(result.data.preview || []);
      } else {
        toast.error(result.data.error || 'Failed to fetch preview');
      }
    } catch (error) {
      console.error('Error fetching preview:', error);
      toast.error('Failed to fetch sheet preview');
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

    // Load data when switching to specific tabs
    if (newValue === 2) { // Monitor tab
      fetchLogs();
    } else if (newValue === 3) { // Edit tab
      fetchPreviewData();
    }
  };

  const handleManualScan = (fullScan = false) => {
    manualScanMutation.mutate(fullScan);
  };

  const handleDeleteEvents = () => {
    if (window.confirm(`Are you sure you want to delete all events from ${deleteMonth}/${deleteYear}?`)) {
      deleteEventsMutation.mutate({ month: deleteMonth, year: deleteYear });
    }
  };

  const getLogIcon = (type) => {
    switch (type) {
      case 'success': return <CheckCircleIcon color="success" />;
      case 'error': return <ErrorIcon color="error" />;
      default: return <InfoIcon color="info" />;
    }
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
          <Tab icon={<PlayIcon />} label="Control" iconPosition="start" />
          <Tab icon={<TimelineIcon />} label="Monitor" iconPosition="start" />
          <Tab icon={<EditIcon />} label="Preview" iconPosition="start" />
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
          </Grid>
        </TabPanel>

        {/* CONTROL TAB */}
        <TabPanel value={currentTab} index={1}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                    <SyncIcon color="primary" />
                    <Typography variant="h6">Manual Synchronization</Typography>
                  </Stack>
                  <Divider sx={{ mb: 2 }} />

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Trigger manual sync operations to process spreadsheet data.
                  </Typography>

                  <Stack spacing={2}>
                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={manualScanMutation.isLoading ? <CircularProgress size={20} /> : <PlayIcon />}
                      onClick={() => handleManualScan(false)}
                      disabled={manualScanMutation.isLoading || !hasCredentials}
                      fullWidth
                    >
                      Quick Scan (New Rows Only)
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
                      <Typography variant="body2">
                        Updated: {manualScanMutation.data.stats?.updated || 0} events
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
                    <Typography variant="h6">Delete Events</Typography>
                  </Stack>
                  <Divider sx={{ mb: 2 }} />

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Remove calendar events by month and year.
                  </Typography>

                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        label="Month"
                        type="number"
                        value={deleteMonth}
                        onChange={(e) => setDeleteMonth(parseInt(e.target.value))}
                        inputProps={{ min: 1, max: 12 }}
                        variant="outlined"
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        label="Year"
                        type="number"
                        value={deleteYear}
                        onChange={(e) => setDeleteYear(parseInt(e.target.value))}
                        variant="outlined"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Button
                        variant="contained"
                        color="error"
                        startIcon={deleteEventsMutation.isLoading ? <CircularProgress size={20} /> : <DeleteIcon />}
                        onClick={handleDeleteEvents}
                        disabled={deleteEventsMutation.isLoading || !hasCredentials}
                        fullWidth
                      >
                        Delete Events
                      </Button>
                    </Grid>
                  </Grid>
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

        {/* PREVIEW TAB */}
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
    </Container>
  );
}

export default ControlCenter;
