import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Paper,
  Typography,
  Button,
  IconButton,
  Stack,
  Chip,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  LinearProgress,
  Alert,
  Tooltip,
  alpha,
  ThemeProvider,
  createTheme,
} from '@mui/material';
import {
  ChevronRight as ChevronRightIcon,
  ChevronLeft as ChevronLeftIcon,
  Sync as SyncIcon,
  Delete as DeleteIcon,
  DeleteSweep as DeleteSweepIcon,
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import useAuthStore from '../store/authStore';
import { useScanMonthEvents, useDeleteEvents, useReprocessSelectedRows, useDeleteSelectedEvents } from '../hooks/useEvents';
import toast from 'react-hot-toast';

// Hebrew dark theme
const darkTheme = createTheme({
  direction: 'rtl',
  palette: {
    mode: 'dark',
    primary: {
      main: '#60a5fa', // Blue-400
      light: '#93c5fd',
      dark: '#3b82f6',
    },
    secondary: {
      main: '#a78bfa', // Purple-400
      light: '#c4b5fd',
      dark: '#8b5cf6',
    },
    background: {
      default: '#0f172a', // Slate-900
      paper: '#1e293b', // Slate-800
    },
    error: {
      main: '#f87171', // Red-400
    },
    success: {
      main: '#4ade80', // Green-400
    },
    text: {
      primary: '#f1f5f9', // Slate-100
      secondary: '#cbd5e1', // Slate-300
    },
  },
  typography: {
    fontFamily: '"Heebo", "Roboto", "Arial", sans-serif',
    h4: {
      fontWeight: 700,
    },
    h6: {
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(148, 163, 184, 0.1)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
        },
      },
    },
  },
});

const months = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

function ControlCenterModern() {
  const { user } = useAuthStore();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [monthEvents, setMonthEvents] = useState([]);
  const [selectedEvents, setSelectedEvents] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [progressDialog, setProgressDialog] = useState({
    open: false,
    title: '',
    message: '',
    progress: 0,
    steps: [],
  });

  // Mutations
  const scanMonthMutation = useScanMonthEvents();
  const deleteMonthMutation = useDeleteEvents();
  const addSelectedMutation = useReprocessSelectedRows();
  const deleteSelectedMutation = useDeleteSelectedEvents();

  // Fetch events for selected month
  const fetchMonthEvents = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const functions = window.functions;
      const getTimeframeEvents = httpsCallable(functions, 'getTimeframeEvents');

      console.log('Fetching events for:', { month: selectedMonth, year: selectedYear });

      const result = await getTimeframeEvents({
        timeframe: 'month',
        month: selectedMonth,
        year: selectedYear
      });

      console.log('Month events result:', result);
      console.log('Result data:', result.data);

      if (result.data.success) {
        const events = result.data.events || [];
        console.log(`Loaded ${events.length} events from backend for ${months[selectedMonth - 1]} ${selectedYear}`);
        setMonthEvents(events);
      } else {
        toast.error('שגיאה בטעינת אירועים');
        setMonthEvents([]);
      }
    } catch (error) {
      console.error('Error fetching month events:', error);
      toast.error(`שגיאה: ${error.message}`);
      setMonthEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonthEvents();
  }, [selectedMonth, selectedYear, user]);

  const handleMonthChange = (direction) => {
    if (direction === 'next') {
      if (selectedMonth === 12) {
        setSelectedMonth(1);
        setSelectedYear(selectedYear + 1);
      } else {
        setSelectedMonth(selectedMonth + 1);
      }
    } else {
      if (selectedMonth === 1) {
        setSelectedMonth(12);
        setSelectedYear(selectedYear - 1);
      } else {
        setSelectedMonth(selectedMonth - 1);
      }
    }
    setSelectedEvents(new Set());
  };

  const handleSelectAll = (event) => {
    if (event.target.checked) {
      const allIndices = new Set(monthEvents.map((_, index) => index));
      setSelectedEvents(allIndices);
    } else {
      setSelectedEvents(new Set());
    }
  };

  const handleSelectEvent = (index) => {
    const newSelected = new Set(selectedEvents);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedEvents(newSelected);
  };

  const handleScanMonth = () => {
    const monthName = months[selectedMonth - 1];

    setProgressDialog({
      open: true,
      title: 'סריקת חודש',
      message: `סורק את ${monthName} ${selectedYear}...`,
      progress: 0,
      steps: ['קריאת נתוני גיליון', 'יצירת אירועים', 'עדכון מעקב', 'סיום']
    });

    scanMonthMutation.mutate(
      { month: selectedMonth, year: selectedYear },
      {
        onSuccess: (data) => {
          setProgressDialog(prev => ({
            ...prev,
            progress: 100,
            message: `נוספו ${data.stats.processed} אירועים בהצלחה!`
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

    const progressInterval = setInterval(() => {
      setProgressDialog(prev => {
        if (!prev.open || prev.progress >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return {
          ...prev,
          progress: Math.min(prev.progress + 15, 90),
          message: prev.steps[Math.floor(prev.progress / 25)] || 'מעבד...'
        };
      });
    }, 600);
  };

  const handleDeleteMonth = () => {
    const monthName = months[selectedMonth - 1];
    if (window.confirm(`למחוק את כל האירועים מ${monthName} ${selectedYear}?`)) {
      setProgressDialog({
        open: true,
        title: 'מחיקת אירועים',
        message: `מוחק אירועים מ${monthName} ${selectedYear}...`,
        progress: 0,
        steps: ['מחפש אירועים', 'מוחק מהיומן', 'מעדכן מעקב', 'סיום']
      });

      deleteMonthMutation.mutate(
        { month: selectedMonth, year: selectedYear },
        {
          onSuccess: (data) => {
            setProgressDialog(prev => ({
              ...prev,
              progress: 100,
              message: `נמחקו ${data.eventsDeleted || 0} אירועים!`
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

      const progressInterval = setInterval(() => {
        setProgressDialog(prev => {
          if (!prev.open || prev.progress >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return {
            ...prev,
            progress: Math.min(prev.progress + 15, 90),
            message: prev.steps[Math.floor(prev.progress / 25)] || 'מעבד...'
          };
        });
      }, 600);
    }
  };

  const handleAddSelected = () => {
    if (selectedEvents.size === 0) {
      toast.error('לא נבחרו אירועים');
      return;
    }

    const rowIndices = Array.from(selectedEvents).map(index => {
      const event = monthEvents[index];
      return event.rowIndex;
    });

    setProgressDialog({
      open: true,
      title: 'הוספת אירועים ליומן',
      message: `מעבד ${selectedEvents.size} אירועים...`,
      progress: 0,
      steps: ['קריאת נתונים', 'יצירת אירועים', 'הוספה ליומן', 'סיום']
    });

    addSelectedMutation.mutate({ rowIndices }, {
      onSuccess: (data) => {
        setProgressDialog(prev => ({
          ...prev,
          progress: 100,
          message: `נוספו ${data.stats.processed} אירועים בהצלחה!`
        }));

        setTimeout(() => {
          setProgressDialog(prev => ({ ...prev, open: false }));
          fetchMonthEvents();
          setSelectedEvents(new Set());
        }, 2000);
      },
      onError: () => {
        setProgressDialog(prev => ({ ...prev, open: false }));
      }
    });

    const progressInterval = setInterval(() => {
      setProgressDialog(prev => {
        if (!prev.open || prev.progress >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return {
          ...prev,
          progress: Math.min(prev.progress + 15, 90),
          message: prev.steps[Math.floor(prev.progress / 25)] || 'מעבד...'
        };
      });
    }, 600);
  };

  const handleDeleteSelected = () => {
    if (selectedEvents.size === 0) {
      toast.error('לא נבחרו אירועים');
      return;
    }

    if (!window.confirm(`למחוק ${selectedEvents.size} אירועים נבחרים?`)) {
      return;
    }

    const rowIndices = Array.from(selectedEvents).map(index => {
      const event = monthEvents[index];
      return event.rowIndex;
    });

    setProgressDialog({
      open: true,
      title: 'מחיקת אירועים',
      message: `מוחק ${selectedEvents.size} אירועים...`,
      progress: 0,
      steps: ['מחפש אירועים', 'מוחק מהיומן', 'מעדכן מעקב', 'סיום']
    });

    deleteSelectedMutation.mutate({ rowIndices }, {
      onSuccess: (data) => {
        setProgressDialog(prev => ({
          ...prev,
          progress: 100,
          message: `נמחקו ${data.stats.deleted} אירועים!`
        }));

        setTimeout(() => {
          setProgressDialog(prev => ({ ...prev, open: false }));
          fetchMonthEvents();
          setSelectedEvents(new Set());
        }, 2000);
      },
      onError: () => {
        setProgressDialog(prev => ({ ...prev, open: false }));
      }
    });

    const progressInterval = setInterval(() => {
      setProgressDialog(prev => {
        if (!prev.open || prev.progress >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return {
          ...prev,
          progress: Math.min(prev.progress + 15, 90),
          message: prev.steps[Math.floor(prev.progress / 25)] || 'מעבד...'
        };
      });
    }, 600);
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <Box
        sx={{
          minHeight: '100vh',
          bgcolor: 'background.default',
          py: 4,
          direction: 'rtl',
        }}
      >
        <Container maxWidth="xl">
          {/* Header */}
          <Paper
            elevation={0}
            sx={{
              p: 4,
              mb: 3,
              background: `linear-gradient(135deg, ${alpha('#60a5fa', 0.1)} 0%, ${alpha('#a78bfa', 0.1)} 100%)`,
              border: '1px solid',
              borderColor: alpha('#60a5fa', 0.2),
            }}
          >
            <Typography variant="h4" gutterBottom sx={{ color: 'primary.light', fontWeight: 700 }}>
              מרכז בקרה - סנכרון יומן
            </Typography>
            <Typography variant="body1" color="text.secondary">
              ניהול וסנכרון אירועים בין גוגל שיטס ליומן
            </Typography>
          </Paper>

          {/* Month Selector */}
          <Paper elevation={0} sx={{ p: 3, mb: 3 }}>
            <Stack direction="row" alignItems="center" spacing={2} justifyContent="center">
              <IconButton
                onClick={() => handleMonthChange('prev')}
                sx={{
                  bgcolor: alpha('#60a5fa', 0.1),
                  '&:hover': { bgcolor: alpha('#60a5fa', 0.2) }
                }}
              >
                <ChevronRightIcon />
              </IconButton>

              <Box sx={{ textAlign: 'center', minWidth: 200 }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.light' }}>
                  {months[selectedMonth - 1]} {selectedYear}
                </Typography>
                <Chip
                  label={`${monthEvents.length} אירועים`}
                  size="small"
                  color="primary"
                  sx={{ mt: 1 }}
                />
              </Box>

              <IconButton
                onClick={() => handleMonthChange('next')}
                sx={{
                  bgcolor: alpha('#60a5fa', 0.1),
                  '&:hover': { bgcolor: alpha('#60a5fa', 0.2) }
                }}
              >
                <ChevronLeftIcon />
              </IconButton>
            </Stack>
          </Paper>

          {/* Action Buttons */}
          <Paper elevation={0} sx={{ p: 3, mb: 3 }}>
            <Stack spacing={2}>
              <Typography variant="h6" gutterBottom>
                פעולות
              </Typography>

              <Stack direction="row" spacing={2} flexWrap="wrap">
                <Button
                  variant="contained"
                  startIcon={<SyncIcon />}
                  onClick={handleScanMonth}
                  disabled={scanMonthMutation.isLoading}
                  sx={{
                    flex: 1,
                    minWidth: 200,
                    background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
                  }}
                >
                  {scanMonthMutation.isLoading ? <CircularProgress size={24} /> : 'סרוק חודש'}
                </Button>

                <Button
                  variant="contained"
                  color="success"
                  startIcon={<AddIcon />}
                  onClick={handleAddSelected}
                  disabled={selectedEvents.size === 0 || addSelectedMutation.isLoading}
                  sx={{ flex: 1, minWidth: 200 }}
                >
                  {addSelectedMutation.isLoading ? <CircularProgress size={24} /> : `הוסף נבחרים (${selectedEvents.size})`}
                </Button>

                <Button
                  variant="contained"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={handleDeleteSelected}
                  disabled={selectedEvents.size === 0 || deleteSelectedMutation.isLoading}
                  sx={{ flex: 1, minWidth: 200 }}
                >
                  {deleteSelectedMutation.isLoading ? <CircularProgress size={24} /> : `מחק נבחרים (${selectedEvents.size})`}
                </Button>

                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteSweepIcon />}
                  onClick={handleDeleteMonth}
                  disabled={deleteMonthMutation.isLoading || monthEvents.length === 0}
                  sx={{ flex: 1, minWidth: 200 }}
                >
                  {deleteMonthMutation.isLoading ? <CircularProgress size={24} /> : 'מחק הכל'}
                </Button>

                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={fetchMonthEvents}
                  disabled={loading}
                  sx={{ flex: 1, minWidth: 200 }}
                >
                  רענן
                </Button>
              </Stack>
            </Stack>
          </Paper>

          {/* Events Table */}
          <Paper elevation={0} sx={{ overflow: 'hidden' }}>
            {loading ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <CircularProgress />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  טוען אירועים...
                </Typography>
              </Box>
            ) : monthEvents.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="h6" color="text.secondary">
                  אין אירועים לחודש זה
                </Typography>
              </Box>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha('#60a5fa', 0.05) }}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selectedEvents.size === monthEvents.length && monthEvents.length > 0}
                          indeterminate={selectedEvents.size > 0 && selectedEvents.size < monthEvents.length}
                          onChange={handleSelectAll}
                        />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>תאריך</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>יום</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>כותרת</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>מיקום</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>שעה</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>מצב</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {monthEvents.map((event, index) => (
                      <TableRow
                        key={index}
                        hover
                        selected={selectedEvents.has(index)}
                        sx={{
                          cursor: 'pointer',
                          '&.Mui-selected': {
                            bgcolor: alpha('#60a5fa', 0.1),
                          },
                          '&.Mui-selected:hover': {
                            bgcolor: alpha('#60a5fa', 0.15),
                          },
                        }}
                      >
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={selectedEvents.has(index)}
                            onChange={() => handleSelectEvent(index)}
                          />
                        </TableCell>
                        <TableCell>{event.date}</TableCell>
                        <TableCell>{event.day}</TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: event.isCanceled ? 400 : 500,
                              textDecoration: event.isCanceled ? 'line-through' : 'none',
                              color: event.isCanceled ? 'error.main' : 'text.primary',
                            }}
                          >
                            {event.title}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 200 }}>
                            {event.location || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {event.startTime || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {event.syncStatus ? (
                            <Chip
                              label={event.syncStatus === 'PROCESSED' ? 'מסונכרן' : event.syncStatus}
                              size="small"
                              color={event.syncStatus === 'PROCESSED' ? 'success' : 'default'}
                              icon={<CheckCircleIcon />}
                            />
                          ) : (
                            <Chip label="לא מסונכרן" size="small" variant="outlined" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Container>

        {/* Progress Dialog */}
        <Dialog
          open={progressDialog.open}
          maxWidth="sm"
          fullWidth
          PaperProps={{
            sx: {
              bgcolor: 'background.paper',
              backgroundImage: 'none',
            },
          }}
        >
          <DialogTitle>{progressDialog.title}</DialogTitle>
          <DialogContent>
            <Stack spacing={3} sx={{ py: 2 }}>
              <Typography variant="body1" color="text.secondary">
                {progressDialog.message}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={progressDialog.progress}
                sx={{ height: 8, borderRadius: 4 }}
              />
              <Typography variant="body2" color="text.secondary" align="center">
                {progressDialog.progress}%
              </Typography>
            </Stack>
          </DialogContent>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
}

export default ControlCenterModern;
