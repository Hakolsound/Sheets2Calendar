import React, { useState, useEffect } from 'react';
import { getFirestore, collection, doc, getDoc, deleteDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import useAuthStore from '../store/authStore';

function SetupPage() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [fetchingPreview, setFetchingPreview] = useState(false);
  
  // State for sync operations
  const [syncOperationStatus, setSyncOperationStatus] = useState({
    inProgress: false,
    message: '',
    type: '', // 'success', 'error', or 'info'
    stats: null,
  });
  
  // State for delete operation
  const [deleteOperationStatus, setDeleteOperationStatus] = useState({
    inProgress: false,
    message: '',
    type: '', // 'success', 'error', or 'info'
  });
  
  // State for delete year confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [yearToDelete, setYearToDelete] = useState(new Date().getFullYear());
  
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
    processedColumnIndex: 5,
    processedMarker: 'PROCESSED',
    updateProcessedStatus: true,
    timezone: 'Asia/Jerusalem',
  });

  // Get Firestore and Functions instances
  const db = getFirestore();
  const functions = getFunctions();

  // Load existing configuration on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        // Check for user credentials
        const credentialsDocRef = doc(db, 'userCredentials', user.uid);
        const credentialsDoc = await getDoc(credentialsDocRef);
        
        // Only continue if credentials exist
        if (credentialsDoc.exists()) {
          const configDocRef = doc(db, 'configurations', user.uid);
          const configDoc = await getDoc(configDocRef);
          
          if (configDoc.exists()) {
            // Merge saved config with fixed values to ensure they're not changed
            const savedConfig = configDoc.data();
            setConfig(prevConfig => ({ 
              ...prevConfig, 
              ...savedConfig,
              // Override with fixed values
              spreadsheetId: FIXED_SPREADSHEET_ID,
              sheetName: FIXED_SHEET_NAME,
              dataRange: FIXED_DATA_RANGE
            }));
          }
          
          // Fetch preview data
          fetchPreviewData();
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching configuration:', error);
        setError('Failed to load configuration');
        setLoading(false);
      }
    };

    fetchConfig();
  }, [user.uid, db]);

  const fetchPreviewData = async () => {
    setFetchingPreview(true);
    setError(null);
    
    try {
      // Call the Cloud Function to get preview data
      const getPreviewDataFn = httpsCallable(functions, 'getSheetPreview');
      const result = await getPreviewDataFn();
      
      console.log("Preview data result:", result.data);
      
      if (result.data.success) {
        setPreviewData(result.data.rows || []);
      } else {
        setError(`Failed to load preview: ${result.data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error fetching preview data:', error);
      setError(`Failed to load preview: ${error.message}`);
    } finally {
      setFetchingPreview(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig(prevConfig => ({
      ...prevConfig,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    
    try {
      const saveConfigFn = httpsCallable(functions, 'saveConfiguration');
      await saveConfigFn(config);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving configuration:', error);
      setError(error.message);
    } finally {
      setSaving(false);
    }
  };

  // Function to handle "Reset Progress & Scan" button
  const handleResetAndScan = async () => {
    // Clear previous status
    setError(null);
    setSyncOperationStatus({
      inProgress: true,
      message: 'Resetting progress and scanning for new events...',
      type: 'info',
      stats: null
    });
    
    try {
      // Call the manualScan function with resetProcessed: true
      const manualScanFn = httpsCallable(functions, 'manualScan');
      const result = await manualScanFn({ resetProcessed: true });
      
      console.log("Reset and scan result:", result.data);
      
      if (result.data.success) {
        setSyncOperationStatus({
          inProgress: false,
          message: 'Reset and scan completed successfully.',
          type: 'success',
          stats: {
            processed: result.data.processedEvents?.length || 0,
            updated: result.data.updatedEvents?.length || 0,
            errors: result.data.errors?.length || 0
          }
        });
      } else {
        setSyncOperationStatus({
          inProgress: false,
          message: `Reset and scan failed: ${result.data.message || 'Unknown error'}`,
          type: 'error',
          stats: null
        });
      }
    } catch (error) {
      console.error('Error during reset and scan:', error);
      setSyncOperationStatus({
        inProgress: false,
        message: `Error: ${error.message}`,
        type: 'error',
        stats: null
      });
    }
  };

  // Function to handle "Update All Events" button
  const handleUpdateAllEvents = async () => {
    // Clear previous status
    setError(null);
    setSyncOperationStatus({
      inProgress: true,
      message: 'Checking all events for updates...',
      type: 'info',
      stats: null
    });
    
    try {
      // Call the scanAllRowsForUpdates function
      const scanAllRowsForUpdatesFn = httpsCallable(functions, 'scanAllRowsForUpdates');
      const result = await scanAllRowsForUpdatesFn({});
      
      console.log("Update all events result:", result.data);
      
      if (result.data.success) {
        setSyncOperationStatus({
          inProgress: false,
          message: result.data.message || 'All events updated successfully.',
          type: 'success',
          stats: result.data.stats
        });
        
        // Refresh preview data to show updated events
        fetchPreviewData();
      } else {
        setSyncOperationStatus({
          inProgress: false,
          message: `Update failed: ${result.data.message || 'Unknown error'}`,
          type: 'error',
          stats: null
        });
      }
    } catch (error) {
      console.error('Error updating all events:', error);
      setSyncOperationStatus({
        inProgress: false,
        message: `Error: ${error.message}`,
        type: 'error',
        stats: null
      });
    }
  };

  // Function to handle single row processing
  const handleProcessNextRow = async () => {
    // Clear previous status
    setError(null);
    setSyncOperationStatus({
      inProgress: true,
      message: 'Processing next row...',
      type: 'info',
      stats: null
    });
    
    try {
      // Call the manualScan function (without reset)
      const manualScanFn = httpsCallable(functions, 'manualScan');
      const result = await manualScanFn({ resetProcessed: false });
      
      console.log("Process next row result:", result.data);
      
      if (result.data.success) {
        setSyncOperationStatus({
          inProgress: false,
          message: result.data.message || 'Row processed successfully.',
          type: 'success',
          stats: {
            processed: result.data.processedEvents?.length || 0,
            updated: result.data.updatedEvents?.length || 0,
            errors: result.data.errors?.length || 0
          }
        });
      } else {
        setSyncOperationStatus({
          inProgress: false,
          message: `Processing failed: ${result.data.message || 'Unknown error'}`,
          type: 'error',
          stats: null
        });
      }
    } catch (error) {
      console.error('Error processing next row:', error);
      setSyncOperationStatus({
        inProgress: false,
        message: `Error: ${error.message}`,
        type: 'error',
        stats: null
      });
    }
  };
  
  // Function to initiate delete calendar events confirmation
  const initiateDeleteEvents = () => {
    setShowDeleteConfirm(true);
    setYearToDelete(new Date().getFullYear());
  };
  
  // Function to cancel delete calendar events
  const cancelDeleteEvents = () => {
    setShowDeleteConfirm(false);
  };
  
  // Function to handle deletion of all calendar events for a year
  const handleDeleteAllEvents = async () => {
    setShowDeleteConfirm(false);
    
    // Clear previous status
    setError(null);
    setDeleteOperationStatus({
      inProgress: true,
      message: `Deleting all events for ${yearToDelete}... This may take a while for large calendars.`,
      type: 'info'
    });
    
    try {
      // Using the month-by-month approach to avoid timeout
      const deleteEventsInMonthFn = httpsCallable(functions, 'deleteEventsInMonth');
      
      let totalDeleted = 0;
      let totalEvents = 0;
      
      // Process one month at a time to avoid timeout
      for (let month = 0; month < 12; month++) {
        setDeleteOperationStatus({
          inProgress: true,
          message: `Deleting events for ${new Date(yearToDelete, month).toLocaleString('default', { month: 'long' })} ${yearToDelete}...`,
          type: 'info'
        });
        
        try {
          // Pass the year and month as parameters
          const result = await deleteEventsInMonthFn({ 
            year: yearToDelete,
            month: month + 1, // API expects 1-12 for months
            includeDuplicates: true // Ensure duplicate events on same day are also deleted
          });
          
          if (result.data.success) {
            totalDeleted += result.data.eventsDeleted || 0;
            totalEvents += result.data.totalEvents || 0;
            
            // Update status after each month
            setDeleteOperationStatus({
              inProgress: true,
              message: `Progress: ${month + 1}/12 months processed. Deleted ${totalDeleted} events so far...`,
              type: 'info'
            });
          } else {
            console.warn(`Issue with month ${month + 1}: ${result.data.message || 'Unknown error'}`);
          }
        } catch (monthError) {
          console.error(`Error processing month ${month + 1}:`, monthError);
          // Continue with next month even if one fails
        }
        
        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Final success message
      setDeleteOperationStatus({
        inProgress: false,
        message: `Successfully deleted ${totalDeleted} out of ${totalEvents} events from ${yearToDelete}`,
        type: 'success'
      });
      
      // Refresh preview data to show updated events
      fetchPreviewData();
    } catch (error) {
      console.error('Error deleting events:', error);
      setDeleteOperationStatus({
        inProgress: false,
        message: `Error: ${error.message || 'Unknown error'}. Some months may have been processed successfully.`,
        type: 'error'
      });
    }
  };

  if (loading) {
    return <div className="loading">Loading configuration...</div>;
  }

  return (
    <div className="setup-container">
      <h1>Sheets to Calendar Setup</h1>
      <p>Configure how the spreadsheet data gets synchronized to your Calendar</p>
      
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">Configuration saved successfully!</div>}
      
      {/* NEW SECTION: Synchronization Controls */}
      <div className="sync-controls-section">
        <h2>Synchronization Controls</h2>
        
        <div className="control-buttons">
          <button 
            onClick={handleProcessNextRow}
            disabled={syncOperationStatus.inProgress || deleteOperationStatus.inProgress}
            className="control-button process-button"
          >
            Process Next Row
          </button>
          
          <button 
            onClick={handleResetAndScan}
            disabled={syncOperationStatus.inProgress || deleteOperationStatus.inProgress}
            className="control-button reset-button"
          >
            Reset Progress & Scan
          </button>
          
          <button 
            onClick={handleUpdateAllEvents}
            disabled={syncOperationStatus.inProgress || deleteOperationStatus.inProgress}
            className="control-button update-button"
          >
            Update All Events
          </button>
          
          <button 
            onClick={initiateDeleteEvents}
            disabled={syncOperationStatus.inProgress || deleteOperationStatus.inProgress}
            className="control-button delete-button"
          >
            Delete Cal Events
          </button>
        </div>
        
        {/* Delete confirmation modal */}
        {showDeleteConfirm && (
          <div className="delete-confirmation-modal">
            <div className="delete-confirmation-content">
              <h3>⚠️ Warning: This will delete ALL calendar events</h3>
              <p>You are about to delete <strong>ALL</strong> events in your calendar for the selected year. This action cannot be undone.</p>
              
              <div className="year-selector">
                <label>Select Year:</label>
                <input 
                  type="number" 
                  value={yearToDelete}
                  onChange={(e) => setYearToDelete(parseInt(e.target.value))}
                  min="2000" 
                  max="2100"
                />
              </div>
              
              <div className="confirmation-actions">
                <button 
                  onClick={cancelDeleteEvents}
                  className="cancel-button"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDeleteAllEvents}
                  className="confirm-delete-button"
                >
                  Yes, Delete All Events
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Status display for sync operations */}
        {syncOperationStatus.message && (
          <div className={`sync-status ${syncOperationStatus.type}`}>
            <div className="status-message">
              {syncOperationStatus.inProgress && <span className="spinner"></span>}
              {syncOperationStatus.message}
            </div>
            
            {syncOperationStatus.stats && (
              <div className="status-stats">
                {syncOperationStatus.stats.rowsWithEventIds !== undefined && (
                  <div className="stat-item">
                    <span className="stat-label">Rows with Event IDs:</span>
                    <span className="stat-value">{syncOperationStatus.stats.rowsWithEventIds}</span>
                  </div>
                )}
                {syncOperationStatus.stats.rowsCheckedForUpdate !== undefined && (
                  <div className="stat-item">
                    <span className="stat-label">Rows Checked:</span>
                    <span className="stat-value">{syncOperationStatus.stats.rowsCheckedForUpdate}</span>
                  </div>
                )}
                {syncOperationStatus.stats.rowsUpdated !== undefined && (
                  <div className="stat-item">
                    <span className="stat-label">Events Updated:</span>
                    <span className="stat-value">{syncOperationStatus.stats.rowsUpdated}</span>
                  </div>
                )}
                {syncOperationStatus.stats.processed !== undefined && (
                  <div className="stat-item">
                    <span className="stat-label">Events Processed:</span>
                    <span className="stat-value">{syncOperationStatus.stats.processed}</span>
                  </div>
                )}
                {syncOperationStatus.stats.updated !== undefined && (
                  <div className="stat-item">
                    <span className="stat-label">Events Updated:</span>
                    <span className="stat-value">{syncOperationStatus.stats.updated}</span>
                  </div>
                )}
                {(syncOperationStatus.stats.errorCount !== undefined || 
                  syncOperationStatus.stats.errors !== undefined) && (
                  <div className="stat-item">
                    <span className="stat-label">Errors:</span>
                    <span className="stat-value">
                      {syncOperationStatus.stats.errorCount !== undefined 
                        ? syncOperationStatus.stats.errorCount 
                        : syncOperationStatus.stats.errors || 0}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* Status display for delete operations */}
        {deleteOperationStatus.message && (
          <div className={`delete-status ${deleteOperationStatus.type}`}>
            <div className="status-message">
              {deleteOperationStatus.inProgress && <span className="spinner"></span>}
              {deleteOperationStatus.message}
            </div>
          </div>
        )}
      </div>
      
      <div className="fixed-info-card">
        <h2>Spreadsheet Information</h2>
        <div className="info-item">
          <strong>Spreadsheet:</strong> {FIXED_SPREADSHEET_ID}
        </div>
        <div className="info-item">
          <strong>Sheet Name:</strong> {FIXED_SHEET_NAME}
        </div>
        <div className="info-item">
          <strong>Data Range:</strong> {FIXED_DATA_RANGE}
        </div>
      </div>
      
      <form onSubmit={handleSubmit} className="setup-form">
        <div className="form-section">
          <h2>Calendar Settings</h2>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                name="enabled"
                checked={config.enabled}
                onChange={handleChange}
              />
              Enable Synchronization
            </label>
          </div>
          
          <div className="form-group">
            <label>Calendar ID</label>
            <input
              type="text"
              name="calendarId"
              value={config.calendarId}
              onChange={handleChange}
              placeholder="primary or calendar ID"
              required
            />
            <small>Use 'primary' for your primary calendar or the specific calendar ID</small>
          </div>
          
          <div className="form-group">
            <label>Timezone</label>
            <input
              type="text"
              name="timezone"
              value={config.timezone}
              onChange={handleChange}
              placeholder="Asia/Jerusalem"
            />
          </div>
        </div>
        
        <div className="form-section">
          <h2>Processing Settings</h2>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                name="updateProcessedStatus"
                checked={config.updateProcessedStatus}
                onChange={handleChange}
              />
              Mark rows as processed in spreadsheet
            </label>
          </div>
          
          {config.updateProcessedStatus && (
            <>
              <div className="form-group">
                <label>Processed Status Column (Index)</label>
                <input
                  type="number"
                  name="processedColumnIndex"
                  value={config.processedColumnIndex}
                  onChange={handleChange}
                  min="0"
                  max="36"
                  required={config.updateProcessedStatus}
                />
                <small>Must be between 0-36 (columns A-AK)</small>
              </div>
              
              <div className="form-group">
                <label>Processed Marker Text</label>
                <input
                  type="text"
                  name="processedMarker"
                  value={config.processedMarker}
                  onChange={handleChange}
                  placeholder="PROCESSED"
                  required={config.updateProcessedStatus}
                />
              </div>
            </>
          )}
        </div>
        
        <div className="form-actions">
          <button type="submit" className="save-button" disabled={saving}>
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </form>
      
      <div className="preview-section">
        <div className="preview-header">
          <h2>Upcoming Events Preview</h2>
          <button 
            onClick={fetchPreviewData} 
            disabled={fetchingPreview}
            className="refresh-button"
          >
            {fetchingPreview ? 'Loading...' : 'Refresh Preview'}
          </button>
        </div>
        
        {fetchingPreview ? (
          <div className="loading">Loading preview data...</div>
        ) : previewData && previewData.length > 0 ? (
          <div className="events-preview-container" dir="rtl">
            {(() => {
              // Group events by date
              const eventsByDate = {};
              previewData.forEach(event => {
                if (!eventsByDate[event.date]) {
                  eventsByDate[event.date] = [];
                }
                eventsByDate[event.date].push(event);
              });
              
              // Get the color for an event type - returns {bg, text}
              const getEventTypeColor = (eventType) => {
                switch (eventType) {
                  case 'סטנדאפ':
                    return { bg: '#E6D4F0', text: '#000000' }; // Light purple with black text
                  case 'מצלמות':
                    return { bg: '#FFF2CC', text: '#000000' }; // Light yellow with black text
                  case 'כנס':
                    return { bg: '#F8CEBD', text: '#000000' }; // Light peach with black text
                  case 'אולפן':
                    return { bg: '#E2F0D9', text: '#000000' }; // Light green with black text
                  case 'שטח':
                    return { bg: '#5C3317', text: '#FFFFFF' }; // Brown with white text
                  case 'חו"ל':
                    return { bg: '#FADBD8', text: '#000000' }; // Light pink with black text
                  case 'השכרות':
                    return { bg: '#1E3F8A', text: '#FFFFFF' }; // Dark blue with white text
                  case 'אופציה':
                    return { bg: '#2F5168', text: '#FFFFFF' }; // Teal with white text
                  case 'הצעת מחיר':
                    return { bg: '#2E7D32', text: '#FFFFFF' }; // Green with white text
                  case 'הפקה':
                    return { bg: '#1E3F8A', text: '#FFFFFF' }; // Dark blue with white text
                  default:
                    return { bg: '#607D8B', text: '#FFFFFF' }; // Blue Grey with white text
                }
              };
              
              return Object.entries(eventsByDate).map(([date, events]) => (
                <div key={date} className="date-group">
                  <div className="date-header">
                    <div className="date-info">
                      <div className="event-date">{date}</div>
                      <div className="event-day">{events[0].day}</div>
                    </div>
                    <div className="events-summary">
                      {events.length} אירועים ליום זה
                    </div>
                  </div>
                  <div className="date-events">
                    {events.map((event, index) => (
                      <div 
                        key={index} 
                        className="event-card"
                        style={{ borderRight: `4px solid ${getEventTypeColor(event.eventTypeD).bg}` }}
                      >
                        <div className="event-type-header">
                          <span 
                            className="event-type-badge"
                            style={{ 
                              backgroundColor: getEventTypeColor(event.eventTypeD).bg,
                              color: getEventTypeColor(event.eventTypeD).text
                            }}
                          >
                            {event.eventTypeD}
                          </span>
                          <div className="event-title">
                            {event.eventType} - {event.title}
                          </div>
                        </div>
                        
                        <div className="event-details">
                          {event.location && (
                            <div className="event-detail-row">
                              <strong>מיקום:</strong> {event.location}
                            </div>
                          )}
                          <div className="event-detail-row">
                            <strong>שעה:</strong> {event.startTime} - {event.endTime}
                          </div>
                          {event.manager && (
                            <div className="event-detail-row">
                              <strong>מנהל אירוע:</strong> {event.manager}
                            </div>
                          )}
                          
                          {event.technicians && event.technicians.length > 0 && (
                            <div className="event-detail-row technicians-section">
                              <strong>טכנאים משובצים:</strong>
                              <div className="technicians-list">
                                {event.technicians.map((tech, idx) => (
                                  <span key={idx} className="technician-badge">
                                    {tech}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {event.notes && (
                            <div className="event-detail-row">
                              <strong>הערות:</strong> {event.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        ) : (
          <p>No upcoming events found. Check spreadsheet for events with future dates in DD/MM/YY format.</p>
        )}
      </div>
      
      <div className="troubleshooting-section">
        <h3>Troubleshooting</h3>
        <p>If you're experiencing issues accessing the spreadsheet or calendar, try resetting your API access:</p>
        <button 
          onClick={async () => {
            try {
              const credentialsDocRef = doc(db, 'userCredentials', user.uid);
              await deleteDoc(credentialsDocRef);
              alert('API access reset. You will now need to re-authorize.');
              window.location.reload();
            } catch (err) {
              setError('Error resetting credentials: ' + err.message);
            }
          }}
          className="reset-button"
        >
          Reset API Access
        </button>
      </div>
      
    </div>
  );
}

export default SetupPage;