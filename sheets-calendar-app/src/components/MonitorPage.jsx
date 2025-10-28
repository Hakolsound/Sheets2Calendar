import React, { useState, useEffect } from 'react';
import { getFirestore, collection, doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import AuthorizeApis from './AuthorizeApis';
import useAuthStore from '../store/authStore';

function MonitorPage() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [config, setConfig] = useState(null);
  const [hasCredentials, setHasCredentials] = useState(false);
  
  // Add state for success messages
  const [successMessage, setSuccessMessage] = useState(null);
  
  // Add state to store manual scan results
  const [manualScanResult, setManualScanResult] = useState(null);
  
  // Add state for debug mode
  const [debugProcessing, setDebugProcessing] = useState(false);
  const [debugResult, setDebugResult] = useState(null);

  // Get Firestore and Functions instances
  const db = getFirestore();
  const functions = getFunctions();

  // Load logs and configuration on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Check for user credentials
        const credentialsDocRef = doc(db, 'userCredentials', user.uid);
        const credentialsDoc = await getDoc(credentialsDocRef);
        setHasCredentials(credentialsDoc.exists());
        
        // Only continue if credentials exist
        if (credentialsDoc.exists()) {
          // Fetch configuration
          const configDocRef = doc(db, 'configurations', user.uid);
          const configDoc = await getDoc(configDocRef);
          
          if (configDoc.exists()) {
            setConfig(configDoc.data());
          }
          
          // Fetch logs
          const getLogsFn = httpsCallable(functions, 'getLogs');
          const result = await getLogsFn({ limit: 50 });
          setLogs(result.data.logs || []);
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching data:', error);
        setError('Failed to load data');
        setLoading(false);
      }
    };

    fetchData();
  }, [user.uid, db, functions]);

  // Handle successful authorization
  const handleAuthComplete = async () => {
    setHasCredentials(true);
    setLoading(true);
    
    try {
      // Fetch configuration
      const configDocRef = doc(db, 'configurations', user.uid);
      const configDoc = await getDoc(configDocRef);
      
      if (configDoc.exists()) {
        setConfig(configDoc.data());
      }
      
      // Fetch logs
      const getLogsFn = httpsCallable(functions, 'getLogs');
      const result = await getLogsFn({ limit: 50 });
      setLogs(result.data.logs || []);
      
    } catch (error) {
      console.error('Error fetching data after auth:', error);
      setError('Failed to load data after authorization');
    } finally {
      setLoading(false);
    }
  };

  // Enhanced manual scan function that stores and displays results
  const handleManualScan = async (resetProcessed = false) => {
    setScanning(true);
    setError(null);
    setSuccessMessage(null);
    setManualScanResult(null);
    
    try {
      const manualScanFn = httpsCallable(functions, 'manualScan');
      const result = await manualScanFn({ resetProcessed });
      
      // Store the result for display
      setManualScanResult(result.data);
      
      // Set success message
      if (result.data.success) {
        if (result.data.processedEvents && result.data.processedEvents.length > 0) {
          setSuccessMessage(`Successfully created ${result.data.processedEvents.length} new events`);
        } else if (result.data.updatedEvents && result.data.updatedEvents.length > 0) {
          setSuccessMessage(`Successfully updated ${result.data.updatedEvents.length} existing events`);
        } else {
          setSuccessMessage(result.data.message || "Operation completed successfully");
        }
      } else {
        setSuccessMessage(result.data.message || "No changes made");
      }
      
      // Refresh config to get updated lastProcessedRow
      const configDocRef = doc(db, 'configurations', user.uid);
      const configDoc = await getDoc(configDocRef);
      
      if (configDoc.exists()) {
        setConfig(configDoc.data());
      }
  
      // Wait a bit then refresh logs
      setTimeout(async () => {
        try {
          const getLogsFn = httpsCallable(functions, 'getLogs');
          const logsResult = await getLogsFn({ limit: 50 });
          setLogs(logsResult.data.logs || []);
        } catch (error) {
          console.error('Error refreshing logs:', error);
        } finally {
          setScanning(false);
        }
      }, 3000);
    } catch (error) {
      console.error('Error triggering manual scan:', error);
      setError(error.message);
      setScanning(false);
    }
  };

  // Add new function for debug processing
  const handleProcessSingleRow = async () => {
    setDebugProcessing(true);
    setError(null);
    setDebugResult(null);
    
    try {
      const processSingleRowFn = httpsCallable(functions, 'processSingleRow');
      const result = await processSingleRowFn();
      setDebugResult(result.data);
      
      // Refresh logs
      const getLogsFn = httpsCallable(functions, 'getLogs');
      const logsResult = await getLogsFn({ limit: 50 });
      setLogs(logsResult.data.logs || []);
      
      // Refresh config to get updated lastProcessedRow
      const configDocRef = doc(db, 'configurations', user.uid);
      const configDoc = await getDoc(configDocRef);
      
      if (configDoc.exists()) {
        setConfig(configDoc.data());
      }
    } catch (error) {
      console.error('Error processing single row:', error);
      setError(error.message);
    } finally {
      setDebugProcessing(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    try {
      // Handle Firestore timestamps
      const date = timestamp.toDate ? timestamp.toDate() : 
                   // Handle timestamp objects sent from functions
                   timestamp._seconds ? new Date(timestamp._seconds * 1000) :
                   // Handle string timestamps
                   new Date(timestamp);
                   
      if (isNaN(date.getTime())) {
        return 'Invalid Date Format';
      }
      
      return date.toLocaleString();
    } catch (error) {
      console.error('Error formatting timestamp:', error, timestamp);
      return 'Date Error';
    }
  };

  // Helper function to display row data in a readable format
  const formatRowData = (rowData) => {
    if (!rowData) return null;
    
    // Create a more human-readable representation of the row
    return (
      <div className="row-data-table">
        <table>
          <tbody>
            {rowData[1] && (
              <tr>
                <td><strong>Date:</strong></td>
                <td>{rowData[1]}</td>
              </tr>
            )}
            {rowData[3] && (
              <tr>
                <td><strong>Event Type:</strong></td>
                <td>{rowData[3]}</td>
              </tr>
            )}
            {rowData[4] && rowData[5] && (
              <tr>
                <td><strong>Event Name:</strong></td>
                <td>{`${rowData[4]} ${rowData[5]}`}</td>
              </tr>
            )}
            {rowData[6] && (
              <tr>
                <td><strong>Location:</strong></td>
                <td>{rowData[6]}</td>
              </tr>
            )}
            {rowData[9] && rowData[10] && (
              <tr>
                <td><strong>Time:</strong></td>
                <td>{`${rowData[9]} - ${rowData[10]}`}</td>
              </tr>
            )}
            {rowData[11] && (
              <tr>
                <td><strong>Manager:</strong></td>
                <td>{rowData[11]}</td>
              </tr>
            )}
            <tr>
              <td><strong>Cancelled:</strong></td>
              <td>{rowData[18] ? "Yes" : "No"}</td>
            </tr>
          </tbody>
        </table>
        
        {/* Technicians section */}
        <div className="technicians-section">
          <strong>Technicians:</strong>
          <ul>
            {[...Array(7)].map((_, i) => {
              const techIndex = 20 + i;
              return rowData[techIndex] ? (
                <li key={techIndex}>{rowData[techIndex]}</li>
              ) : null;
            }).filter(Boolean)}
          </ul>
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="loading">Loading monitoring data...</div>;
  }
  
  // Show authorization component if no credentials
  if (!hasCredentials) {
    return <AuthorizeApis user={user} onComplete={handleAuthComplete} />;
  }

  return (
    <div className="monitor-container">
      <h1>Monitoring Dashboard</h1>
      
      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}
      
      <div className="config-status">
        <h2>Configuration Status</h2>
        {config ? (
          <div className="status-card">
            <div className="status-item">
              <strong>Sync Status:</strong> 
              <span className={config.enabled ? 'status-enabled' : 'status-disabled'}>
                {config.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="status-item">
              <strong>Spreadsheet:</strong> {config.sheetName} ({config.spreadsheetId})
            </div>
            <div className="status-item">
              <strong>Calendar:</strong> {config.calendarId}
            </div>
            <div className="status-item">
              <strong>Last Processed Row:</strong> {config.lastProcessedRow || 0}
            </div>
            <div className="status-item">
              <strong>Last Scan:</strong> {formatTimestamp(config.lastScanTime)}
            </div>
          </div>
        ) : (
          <p>No configuration found. Please set up your configuration first.</p>
        )}
      </div>
      
      <div className="manual-actions">
        <h2>Manual Actions</h2>
        <div className="action-buttons">
          <button 
            onClick={() => handleManualScan(false)} 
            disabled={scanning || !config}
            className="action-button"
          >
            {scanning ? 'Scanning...' : 'Process Next Row'}
          </button>
          
          <button 
            onClick={() => handleManualScan(true)} 
            disabled={scanning || !config}
            className="action-button warning"
          >
            Reset Progress & Scan
          </button>
        </div>
        
        {/* Display manual scan result */}
        {manualScanResult && (
          <div className="manual-scan-result">
            <h3>Last Processed Row</h3>
            <div className="status-card">
              <div className="status-item">
                <strong>Status:</strong> 
                <span className={manualScanResult.success ? 'status-enabled' : 'status-disabled'}>
                  {manualScanResult.success ? 'Success' : 'Failed'}
                </span>
              </div>
              <div className="status-item">
                <strong>Row Index:</strong> {manualScanResult.rowIndex}
              </div>
              <div className="status-item">
                <strong>Message:</strong> {manualScanResult.message}
              </div>
              
              {/* Display event details if created */}
              {manualScanResult.processedEvents && manualScanResult.processedEvents.length > 0 && (
                <div className="event-details">
                  <strong>Event Created:</strong> {manualScanResult.processedEvents[0].summary}
                  {manualScanResult.processedEvents[0].eventId && (
                    <div>
                      <strong>Event ID:</strong> {manualScanResult.processedEvents[0].eventId}
                    </div>
                  )}
                </div>
              )}
              
              {/* Display event details if updated */}
              {manualScanResult.updatedEvents && manualScanResult.updatedEvents.length > 0 && (
                <div className="event-details">
                  <strong>Event Updated:</strong> {manualScanResult.updatedEvents[0].summary}
                  {manualScanResult.updatedEvents[0].changes && (
                    <div>
                      <strong>Changes:</strong> {manualScanResult.updatedEvents[0].changes.join(', ')}
                    </div>
                  )}
                </div>
              )}
              
              {/* Display row data in readable format */}
              {manualScanResult.rowData && (
                <div className="row-data-container">
                  <h4>Row Data</h4>
                  {formatRowData(manualScanResult.rowData)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Debug section */}
      <div className="debug-section">
        <h2>Debug Tools</h2>
        <p>Process one row at a time to test your configuration</p>
        
        <button 
          onClick={handleProcessSingleRow} 
          disabled={debugProcessing || !config}
          className="action-button debug"
        >
          {debugProcessing ? 'Processing...' : 'Process Single Row'}
        </button>
        
        {debugResult && (
          <div className="debug-result">
            <h3>Debug Result</h3>
            <div className="status-card">
              <div className="status-item">
                <strong>Status:</strong> 
                <span className={debugResult.success ? 'status-enabled' : 'status-disabled'}>
                  {debugResult.success ? 'Success' : 'Failed'}
                </span>
              </div>
              <div className="status-item">
                <strong>Row Index:</strong> {debugResult.rowIndex}
              </div>
              <div className="status-item">
                <strong>Message:</strong> {debugResult.message}
              </div>
              
              {debugResult.eventCreated && (
                <>
                  <div className="status-item">
                    <strong>Event Created:</strong> {debugResult.eventCreated.summary}
                  </div>
                  <div className="status-item">
                    <strong>Event Link:</strong> 
                    <a href={debugResult.eventCreated.link} target="_blank" rel="noopener noreferrer">
                      Open in Calendar
                    </a>
                  </div>
                </>
              )}
              
              {debugResult.rowData && (
                <div className="row-data-container">
                  <h4>Row Data</h4>
                  {formatRowData(debugResult.rowData)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      <div className="logs-section">
        <h2>Processing Logs</h2>
        
        {logs.length === 0 ? (
          <p>No logs found. Run a scan to generate logs.</p>
        ) : (
          <div className="logs-table-container">
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Type</th>
                  <th>Events</th>
                  <th>Errors</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td>{formatTimestamp(log.timestamp)}</td>
                    <td>{log.manualScan ? 'Manual' : log.debugMode ? 'Debug' : 'Scheduled'}</td>
                    <td>{(log.processedEvents?.length || 0) + (log.updatedEvents?.length || 0)}</td>
                    <td className={log.errors?.length ? 'error-cell' : ''}>
                      {log.errors?.length || 0}
                    </td>
                    <td>
                      {log.rowsScanned !== undefined && 
                        <div>Rows scanned: {log.rowsScanned}</div>
                      }
                      {log.resetProcessed && 
                        <div className="reset-marker">Progress reset</div>
                      }
                      {log.message && 
                        <div>{log.message}</div>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* Add some CSS for the new components */}
      <style jsx>{`
        .row-data-table {
          margin-top: 10px;
          width: 100%;
        }
        
        .row-data-table table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .row-data-table td {
          padding: 5px;
          border-bottom: 1px solid #eee;
        }
        
        .row-data-table td:first-child {
          width: 120px;
          font-weight: bold;
        }
        
        .technicians-section {
          margin-top: 10px;
        }
        
        .technicians-section ul {
          margin-top: 5px;
          margin-bottom: 0;
          padding-left: 20px;
        }
        
        .event-details {
          margin-top: 10px;
          padding: 10px;
          background-color: #f5f5f5;
          border-radius: 4px;
        }
        
        .success-message {
          padding: 10px;
          margin: 10px 0;
          background-color: #d4edda;
          color: #155724;
          border-radius: 4px;
        }
        
        .row-data-container {
          margin-top: 15px;
          padding: 10px;
          background-color: #f8f9fa;
          border-radius: 4px;
        }
        
        .row-data-container h4 {
          margin-top: 0;
          margin-bottom: 10px;
        }
        
        .manual-scan-result {
          margin-top: 20px;
        }
      `}</style>
    </div>
  );
}

export default MonitorPage;