// index.js - Main Firebase Cloud Functions file



const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {google} = require("googleapis");
const sheets = google.sheets("v4");
const calendar = google.calendar("v3");
const serviceAccount = require('./service-account-key.json');
const moment = require('moment');
const axios = require('axios');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { GoogleAuth } = require('google-auth-library');
const { Storage } = require('@google-cloud/storage');
const cors = require('cors')({ origin: true });
require('moment-timezone'); // This extends the moment object


admin.initializeApp();
const db = admin.firestore();

// ===== HELPER FUNCTIONS =====

function getValidSheetRowNum(rowIndex) {
  // The sheet row number is the row index + 1 (to convert from 0-based to 1-based)
  // For example: rowIndex 7 points to row 8 in the sheet
  if (typeof rowIndex !== 'number') {
    console.error(`Invalid row index type: ${typeof rowIndex}, value: ${rowIndex}, using default of 1`);
    return 1;
  }
  
  if (rowIndex < 0) {
    console.error(`Invalid negative row index: ${rowIndex}, using default of 1`);
    return 1;
  }
  
  // This is the critical fix: do NOT add 1 again if we're already dealing with a 1-based row number
  return rowIndex + 2;
}

/**
 * Simple rate limiter for API calls
 * @param {number} maxRequestsPerMinute - Maximum requests per minute
 */
class RateLimiter {
  constructor(maxRequestsPerMinute = 50) {
    this.queue = [];
    this.processing = false;
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.requestsThisMinute = 0;
    this.resetInterval = setInterval(() => {
      this.requestsThisMinute = 0;
      this.processQueue();
    }, 60 * 1000); // Reset counter every minute
  }
  
  /**
   * Add a function to the rate-limited queue
   * @param {Function} fn - Async function to execute
   * @returns {Promise} Promise that resolves with the function result
   */
  async enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fn,
        resolve,
        reject
      });
      
      this.processQueue();
    });
  }
  
  /**
   * Process items in the queue respecting rate limits
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    try {
      while (this.queue.length > 0 && this.requestsThisMinute < this.maxRequestsPerMinute) {
        const { fn, resolve, reject } = this.queue.shift();
        this.requestsThisMinute++;
        
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
        
        // Add a small delay between requests
        await new Promise(r => setTimeout(r, 200));
      }
    } finally {
      this.processing = false;
      
      // If we've hit the rate limit, set a timer to continue processing
      if (this.queue.length > 0 && this.requestsThisMinute >= this.maxRequestsPerMinute) {
        console.log(`Rate limit reached (${this.maxRequestsPerMinute} requests per minute), pausing for a bit`);
        setTimeout(() => this.processQueue(), 5000);
      }
    }
  }
  
  /**
   * Clean up the rate limiter
   */
  destroy() {
    clearInterval(this.resetInterval);
    this.queue = [];
  }
}

const sheetsRateLimiter = new RateLimiter(40); // Limit to 40 requests per minute


// Example of using rate limiter with batch updates:
async function batchUpdateRowsWithRateLimit(sheetService, config, updates) {
  if (!updates || updates.length === 0) return;
  
  console.log(`Performing batch update for ${updates.length} rows with rate limiting`);
  
  try {
    // The processedColumnIndex from config or default to column AK (index 36)
    const processedColumnIndex = config.processedColumnIndex !== undefined ? 
                                config.processedColumnIndex : 36;
    
    // Always use column AL (index 37) for event IDs
    const eventIdColumnIndex = 37; // Hardcoded to AL
    
    // Prepare batch requests for processed status
    if (config.updateProcessedStatus !== false) {
      const processedUpdates = updates.map(update => {
        const sheetRowNum = getValidSheetRowNum(rowIndex);
        const value = update.isCancelled ? "CANCELLED" : (config.processedMarker || "PROCESSED");
        
        return {
          range: `${config.sheetName}!${getColumnLetter(processedColumnIndex)}${sheetRowNum}`,
          values: [[value]]
        };
      });
      
      // Execute batch update for processed status with rate limiting
      if (processedUpdates.length > 0) {
        await sheetsRateLimiter.enqueue(async () => {
          return await sheetService.spreadsheets.values.batchUpdate({
            spreadsheetId: config.spreadsheetId,
            resource: {
              valueInputOption: "RAW",
              data: processedUpdates
            }
          });
        });
        console.log(`✓ Successfully updated processed status for ${processedUpdates.length} rows`);
      }
    }
    
    // Prepare batch requests for event IDs
    const eventIdUpdates = updates.map(update => {
      const sheetRowNum = getValidSheetRowNum(rowIndex);
      
      return {
        range: `${config.sheetName}!${getColumnLetter(eventIdColumnIndex)}${sheetRowNum}`,
        values: [[update.eventId]]
      };
    });
    
    // Execute batch update for event IDs with rate limiting
    if (eventIdUpdates.length > 0) {
      await sheetsRateLimiter.enqueue(async () => {
        return await sheetService.spreadsheets.values.batchUpdate({
          spreadsheetId: config.spreadsheetId,
          resource: {
            valueInputOption: "RAW",
            data: eventIdUpdates
          }
        });
      });
      console.log(`✓ Successfully stored event IDs for ${eventIdUpdates.length} rows`);
    }
  } catch (error) {
    console.error(`❌ Error in batch update: ${error.message}`);
    console.error(error);
  }
}

/**
 * Process multiple rows in a batch to avoid API quota limits
 * @param {Object} sheetService - The Google Sheets API service
 * @param {Object} config - The user's configuration
 * @param {Array} updates - Array of updates [{rowIndex, eventId, isCancelled}]
 */
async function batchUpdateRows(sheetService, config, updates) {
  if (!updates || updates.length === 0) return;
  
  console.log(`Performing batch update for ${updates.length} rows`);
  
  try {
    // The processedColumnIndex from config or default to column AK (index 36)
    const processedColumnIndex = config.processedColumnIndex !== undefined ? 
                                config.processedColumnIndex : 36;
    
    // Always use column AL (index 37) for event IDs
    const eventIdColumnIndex = 37; // Hardcoded to AL
    
    // FIXED: This code now properly uses the rowIndex from the update object
    // Prepare batch requests for processed status
    if (config.updateProcessedStatus !== false) {
      const processedUpdates = updates.map(update => {
        // Ensure we're using the rowIndex from the update object, not some external variable
        const sheetRowNum = getValidSheetRowNum(update.rowIndex);
        const value = update.isCancelled ? "CANCELLED" : (config.processedMarker || "PROCESSED");
        
        console.log(`Batch update: index ${update.rowIndex} -> sheet row ${sheetRowNum}, value: ${value}`);
        
        return {
          range: `${config.sheetName}!${getColumnLetter(processedColumnIndex)}${sheetRowNum}`,
          values: [[value]]
        };
      });
      
      // Execute batch update for processed status
      if (processedUpdates.length > 0) {
        await sheetService.spreadsheets.values.batchUpdate({
          spreadsheetId: config.spreadsheetId,
          resource: {
            valueInputOption: "RAW",
            data: processedUpdates
          }
        });
        console.log(`✓ Successfully updated processed status for ${processedUpdates.length} rows`);
      }
    }
    
    // Prepare batch requests for event IDs
    const eventIdUpdates = updates.map(update => {
      // Use the rowIndex from the update object
      const sheetRowNum = getValidSheetRowNum(update.rowIndex);
      
      return {
        range: `${config.sheetName}!${getColumnLetter(eventIdColumnIndex)}${sheetRowNum}`,
        values: [[update.eventId]]
      };
    });
    
    // Execute batch update for event IDs
    if (eventIdUpdates.length > 0) {
      await sheetService.spreadsheets.values.batchUpdate({
        spreadsheetId: config.spreadsheetId,
        resource: {
          valueInputOption: "RAW",
          data: eventIdUpdates
        }
      });
      console.log(`✓ Successfully stored event IDs for ${eventIdUpdates.length} rows`);
    }
  } catch (error) {
    console.error(`❌ Error in batch update: ${error.message}`);
    console.error(error);
  }
}

function getTechnicians(row) {
  const technicians = [];
  
  // Columns U-AA (indices 20-26) - all 7 columns for techs
  for (let i = 20; i <= 26; i++) {
    if (row[i] && row[i].trim()) {
      // Create a fresh copy of the trimmed string to avoid reference issues
      const techName = String(row[i].trim());
      technicians.push(techName);
      
      // Log every technician extraction for all columns U-AA
      const colLetter = String.fromCharCode(85 + (i-20)); // U is 85 in ASCII
      console.log(`Extracted technician from column ${colLetter}: "${techName}"`);
    } else {
      // Log even empty cells in all columns
      const colLetter = String.fromCharCode(85 + (i-20));
      console.log(`Column ${colLetter} is empty`);
    }
  }
  
  console.log(`Total technicians extracted: ${technicians.length}`);
  if (technicians.length > 0) {
    console.log(`All technicians: ${technicians.join(', ')}`);
  }
  return technicians;
}

function hasEventId(row, config) {
  const eventIdColumnIndex = config.eventIdColumnIndex !== undefined ? 
                             config.eventIdColumnIndex : 37; // Default to column AL
  return row && row[eventIdColumnIndex];
}

async function logAllEventIds(sheetService, config) {
  console.log("Scanning for all event IDs in the sheet...");
  
  // Use the configured eventIdColumnIndex or default to column AL (index 37)
  const eventIdColumnIndex = config.eventIdColumnIndex !== undefined ? 
                             config.eventIdColumnIndex : 37; // Default to column AL
  
  console.log(`Using column ${getColumnLetter(eventIdColumnIndex)} (index ${eventIdColumnIndex}) for event IDs`);
  
  try {
    // Read just the event ID column
    const sheetResponse = await sheetService.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `${config.sheetName}!${getColumnLetter(eventIdColumnIndex)}:${getColumnLetter(eventIdColumnIndex)}`,
    });
    
    const values = sheetResponse.data.values || [];
    
    console.log(`Found ${values.length} rows in the event ID column`);
    
    // Count and log non-empty cells
    let count = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] && values[i][0]) {
        count++;
        console.log(`Row ${i+1} has event ID: ${values[i][0]}`);
      }
    }
    
    console.log(`Found ${count} event IDs in column ${getColumnLetter(eventIdColumnIndex)}`);
    
  } catch (error) {
    console.error(`Error scanning for event IDs: ${error.message}`);
  }
}

// Helper function for date parsing based on DD/MM/YY format
function parseEventDate(dateStr, timeStr = "17:00") {
  try {
    // Parse DD/MM/YY format
    const dateParts = dateStr.split('/');
    if (dateParts.length !== 3) {
      console.log("Date doesn't have 3 parts:", dateStr);
      return null;
    }
    
    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1; // 0-based month
    const year = 2000 + parseInt(dateParts[2], 10); // Expand to 4-digit year
    
    // Parse HH:MM format for time
    let hours = 17, minutes = 0;
    if (timeStr && timeStr.includes(':')) {
      const timeParts = timeStr.split(':');
      hours = parseInt(timeParts[0], 10);
      minutes = parseInt(timeParts[1], 10);
    }
    
    // Create the date directly as an ISO string with the correct timezone
    // Note: Manually creating the ISO string with timezone
    const pad = (num) => String(num).padStart(2, '0');
    
    // Format: YYYY-MM-DDTHH:MM:00+02:00 (Israel Standard Time)
    const isoDateString = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00+02:00`;
    
    console.log(`Created date string with timezone: ${isoDateString}`);
    return isoDateString;
  } catch (error) {
    console.error("Error parsing date:", error, dateStr, timeStr);
    return null;
  }
}

/**
 * Initialize the lastProcessedRow value
 * @param {Object} config - The user's configuration
 * @returns {number} The initialized lastProcessedRow value
 */
function initializeLastProcessedRow(config) {
  // Get last processed row ID from config
  let lastProcessedRow = config.lastProcessedRow || 0;
  
  // Make sure we start at at least row 2 (index 1) to skip headers
  if (lastProcessedRow < 2) {
    lastProcessedRow = 2;
    console.log("Adjusted lastProcessedRow to 2 to skip headers");
  }
  
  return lastProcessedRow;
}

// Helper function for date/time formatting
function formatDateTimeWithTZ(dateStr, timeStr) {
  try {
    const dateParts = dateStr.split('/');
    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10);
    const year = 2000 + parseInt(dateParts[2], 10);
    
    const timeParts = timeStr.split(':');
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10) || 0;
    
    // Format: YYYY-MM-DDTHH:MM:00+02:00 (Israel Standard Time)
    const pad = (num) => String(num).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00+02:00`;
  } catch (error) {
    console.error('Error formatting date with timezone:', error);
    // Return a default value
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T17:00:00+02:00`;
  }
}

// Helper function to convert column index to letter
function getColumnLetter(index) {
  let temp; let letter = "";
  let i = index;
  while (i >= 0) {
    temp = i % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    i = Math.floor(i / 26) - 1;
  }
  return letter;
}

// ===== FIREBASE EVENT TRACKING HELPERS =====
// These functions manage event tracking in Firebase instead of the spreadsheet
// to prevent accidental deletion and provide more reliable tracking

/**
 * Save event tracking data to Firebase
 * @param {string} userId - User ID
 * @param {number} rowIndex - 0-based row index in the data array
 * @param {string} eventId - Calendar event ID
 * @param {string} status - Status: PROCESSED, CANCELLED, UPDATED, etc.
 * @param {Object} eventData - Additional event data (title, date, location, etc.)
 */
async function saveEventTracking(userId, rowIndex, eventId, status, eventData = {}) {
  try {
    const sheetRow = rowIndex + 2; // Convert to actual sheet row number
    const trackingData = {
      eventId: eventId,
      status: status,
      sheetRow: sheetRow,
      rowIndex: rowIndex,
      title: eventData.title || '',
      date: eventData.date || '',
      location: eventData.location || '',
      lastSync: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Create or update the tracking document
    const docRef = db.collection('eventTracking')
      .doc(userId)
      .collection('events')
      .doc(`row_${rowIndex}`);

    const doc = await docRef.get();
    if (!doc.exists) {
      trackingData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }

    await docRef.set(trackingData, { merge: true });
    console.log(`✓ Saved event tracking for row ${sheetRow} (rowIndex: ${rowIndex})`);

    return true;
  } catch (error) {
    console.error(`Error saving event tracking for row ${rowIndex}:`, error.message);
    return false;
  }
}

/**
 * Get event tracking data from Firebase
 * @param {string} userId - User ID
 * @param {number} rowIndex - 0-based row index in the data array
 * @returns {Object|null} Event tracking data or null if not found
 */
async function getEventTracking(userId, rowIndex) {
  try {
    const docRef = db.collection('eventTracking')
      .doc(userId)
      .collection('events')
      .doc(`row_${rowIndex}`);

    const doc = await docRef.get();
    if (doc.exists) {
      return doc.data();
    }
    return null;
  } catch (error) {
    console.error(`Error getting event tracking for row ${rowIndex}:`, error.message);
    return null;
  }
}

/**
 * Get all event tracking data for a user
 * @param {string} userId - User ID
 * @returns {Array} Array of event tracking data with rowIndex as key
 */
async function getAllEventTracking(userId) {
  try {
    const snapshot = await db.collection('eventTracking')
      .doc(userId)
      .collection('events')
      .get();

    const trackingData = {};
    snapshot.forEach(doc => {
      const data = doc.data();
      trackingData[data.rowIndex] = data;
    });

    console.log(`Retrieved tracking data for ${Object.keys(trackingData).length} events`);
    return trackingData;
  } catch (error) {
    console.error('Error getting all event tracking:', error.message);
    return {};
  }
}

/**
 * Delete event tracking data from Firebase
 * @param {string} userId - User ID
 * @param {number} rowIndex - 0-based row index in the data array
 */
async function deleteEventTracking(userId, rowIndex) {
  try {
    await db.collection('eventTracking')
      .doc(userId)
      .collection('events')
      .doc(`row_${rowIndex}`)
      .delete();

    console.log(`✓ Deleted event tracking for row ${rowIndex + 2} (rowIndex: ${rowIndex})`);
    return true;
  } catch (error) {
    console.error(`Error deleting event tracking for row ${rowIndex}:`, error.message);
    return false;
  }
}

/**
 * Batch save event tracking data
 * @param {string} userId - User ID
 * @param {Array} trackingUpdates - Array of {rowIndex, eventId, status, eventData} objects
 */
async function batchSaveEventTracking(userId, trackingUpdates) {
  try {
    console.log(`Batch saving ${trackingUpdates.length} event tracking records...`);

    // Firestore has a limit of 500 operations per batch
    const batchSize = 500;
    for (let i = 0; i < trackingUpdates.length; i += batchSize) {
      const batch = db.batch();
      const chunk = trackingUpdates.slice(i, i + batchSize);

      for (const update of chunk) {
        const { rowIndex, eventId, status, eventData = {} } = update;
        const sheetRow = rowIndex + 2;

        const docRef = db.collection('eventTracking')
          .doc(userId)
          .collection('events')
          .doc(`row_${rowIndex}`);

        const trackingData = {
          eventId: eventId,
          status: status,
          sheetRow: sheetRow,
          rowIndex: rowIndex,
          title: eventData.title || '',
          date: eventData.date || '',
          location: eventData.location || '',
          lastSync: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        batch.set(docRef, trackingData, { merge: true });
      }

      await batch.commit();
      console.log(`✓ Committed batch ${Math.floor(i / batchSize) + 1} (${chunk.length} records)`);
    }

    console.log(`✓ Batch saved all ${trackingUpdates.length} event tracking records`);
    return true;
  } catch (error) {
    console.error('Error in batch save event tracking:', error.message);
    return false;
  }
}

// Helper functions for custom date/time handling
function getStartDateTime(row, dateIndex) {
  const dateStr = row[dateIndex]; // Date is in column B (index 1)
  const timeValue = row[9] ? row[9] : '17:00'; // Time from column J
  
  // Get formatted ISO string with timezone
  const isoDateString = parseEventDate(dateStr, timeValue);
  if (isoDateString) {
    return isoDateString; // Already in correct format with timezone
  }
  
  // Fallback with default timezone
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const pad = (num) => String(num).padStart(2, '0');
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T17:00:00+02:00`;
}

function getEndDateTime(row, dateIndex) {
  const dateStr = row[dateIndex]; // Date is in column B (index 1)
  const timeValue = row[10] ? row[10] : '20:00'; // Time from column K
  
  // Get formatted ISO string with timezone
  const isoDateString = parseEventDate(dateStr, timeValue);
  if (isoDateString) {
    return isoDateString; // Already in correct format with timezone
  }
  
  // Fallback with default timezone
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const pad = (num) => String(num).padStart(2, '0');
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T20:00:00+02:00`;
}

function parseDate(dateStr) {
  try {
    const parts = dateStr.split('/');
    return new Date(2000 + parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  } catch (e) {
    return new Date();
  }
}

/**
 * Check if a row's date is within the scanning range (today-7days to future)
 * Used by scheduled functions to only process recent and upcoming events
 */
function isWithinScanningRange(row) {
  const dateStr = row[1]; // Date is in column B (index 1)
  if (!dateStr) return false;

  try {
    const eventDate = parseDate(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7); // 7 days ago

    // Return true if event date is from 7 days ago onwards
    return eventDate >= sevenDaysAgo;
  } catch (e) {
    console.log(`Error parsing date "${dateStr}": ${e.message}`);
    return false;
  }
}



/**
 * Helper function to fetch hyperlinks from Column T for specific rows
 * @param {object} sheetService - Google Sheets API service
 * @param {string} spreadsheetId - Spreadsheet ID
 * @param {string} sheetName - Sheet name
 * @param {Array} rowIndices - Array of 0-based row indices
 * @returns {Object} Map of rowIndex to hyperlink URL
 */
async function fetchCoordinationSheetLinks(sheetService, spreadsheetId, sheetName, rowIndices) {
  const hyperlinks = {};

  try {
    // Column T is index 19 (0-based), which is column "T" in A1 notation
    // Fetch cell data with hyperlinks for Column T
    const batchSize = 50;
    for (let i = 0; i < rowIndices.length; i += batchSize) {
      const batch = rowIndices.slice(i, i + batchSize);
      const ranges = batch.map(rowIndex => {
        const sheetRow = rowIndex + 2; // +2 for header row
        return `${sheetName}!T${sheetRow}`;
      });

      const response = await sheetService.spreadsheets.get({
        spreadsheetId: spreadsheetId,
        ranges: ranges,
        fields: 'sheets(data(rowData(values(hyperlink))))'
      });

      if (response.data && response.data.sheets && response.data.sheets[0].data) {
        response.data.sheets[0].data.forEach((rangeData, idx) => {
          if (rangeData.rowData && rangeData.rowData[0] && rangeData.rowData[0].values) {
            const cell = rangeData.rowData[0].values[0];
            if (cell && cell.hyperlink) {
              const rowIndex = batch[idx];
              hyperlinks[rowIndex] = cell.hyperlink;
              console.log(`Found hyperlink for row ${rowIndex + 2}: ${cell.hyperlink}`);
            }
          }
        });
      }
    }

    console.log(`Fetched ${Object.keys(hyperlinks).length} coordination sheet links`);
  } catch (error) {
    console.error('Error fetching coordination sheet links:', error.message);
  }

  return hyperlinks;
}

/**
 * Enhanced helper function for description formatting with technicians
 * @param {Array} row - The row data
 * @returns {string} Formatted description
 */
function formatDescription(row, coordinationSheetUrl = null) {
  let description = '';

  // Add coordination sheet with embedded hyperlink if exists (Column T - index 19)
  if (coordinationSheetUrl) {
    // Make "דף תיאום" itself clickable
    description += `<a href="${coordinationSheetUrl}">דף תיאום</a>\n\n`;
  } else if (row[19]) {
    // If no URL but there's text, still show it
    description += `דף תיאום: ${row[19]}\n\n`;
  }

  // Add event manager (Column L - index 11)
  const manager = row[11] || '';
  if (manager) {
    description += `מנהל אירוע: ${manager}\n\n`;
  }

  // Add technicians section with clear separation for parsing
  description += 'טכנאים משובצים:\n';

  // Get technicians from columns U-AC (indices 20-28)
  const technicians = [];
  for (let i = 20; i <= 28; i++) {
    if (row[i] && row[i].trim()) {
      technicians.push(row[i].trim());
    }
  }

  // Add each technician to the description
  if (technicians.length > 0) {
    for (const tech of technicians) {
      description += `${tech}\n`;
    }
  } else {
    description += 'אין טכנאים משובצים\n';
  }

  return description;
}

/**
 * Enhanced helper function to compare technician lists for equality
 * @param {Array} list1 - First list of technicians
 * @param {Array} list2 - Second list of technicians
 * @returns {boolean} Whether the lists are equal
 */
function areTechnicianListsEqual(list1, list2) {
  // First, normalize both lists - trim whitespace, remove empty entries
  const normalized1 = list1.map(tech => tech.trim()).filter(tech => tech !== '');
  const normalized2 = list2.map(tech => tech.trim()).filter(tech => tech !== '');
  
  // Log normalized lists for debugging
  console.log(`Comparing technicians - normalized lists:`);
  console.log(`List 1: ${JSON.stringify(normalized1)}`);
  console.log(`List 2: ${JSON.stringify(normalized2)}`);
  
  // Check length first
  if (normalized1.length !== normalized2.length) {
    console.log(`Lists have different lengths: ${normalized1.length} vs ${normalized2.length}`);
    return false;
  }
  
  // Convert to sets to ignore order
  const set1 = new Set(normalized1);
  const set2 = new Set(normalized2);
  
  // If sizes differ after set conversion, there are duplicates that were counted differently
  if (set1.size !== set2.size) {
    console.log(`Sets have different sizes: ${set1.size} vs ${set2.size}`);
    return false;
  }
  
  // Check if every element in set1 exists in set2
  for (const tech of set1) {
    if (!set2.has(tech)) {
      console.log(`Technician "${tech}" exists in list 1 but not in list 2`);
      return false;
    }
  }
  
  return true;
}
async function checkAndUpdateEventEnhanced(
  sheetService,
  calendarService, 
  config,
  row,
  rowIndex,
  updatedEvents
) {
  const eventId = row[config.eventIdColumnIndex];
  console.log(`\n----- ENHANCED UPDATE CHECK for Row ${rowIndex} / Event ID: ${eventId} -----`);
  
  // Get the existing event from the calendar
  let existingEvent;
  try {
    const eventResponse = await calendarService.events.get({
      calendarId: config.calendarId,
      eventId: eventId
    });
    existingEvent = eventResponse.data;
    console.log(`Successfully retrieved event from calendar: ${eventId}`);
  } catch (getError) {
    console.error(`Error getting event ${eventId}: ${getError.message}`);
    return; // Skip if we can't get the event
  }
  
  // Get technicians from the spreadsheet row
  console.log(`\nEXAMINING TECHNICIANS IN ROW ${rowIndex}:`);
  console.log(`Raw row data for technician columns U-AA:`);
  for (let i = 20; i <= 26; i++) {
    const colLetter = String.fromCharCode(85 + (i-20)); // U is 85 in ASCII
    console.log(`Column ${colLetter} (index ${i}): "${row[i] || '(empty)'}""`);
  }
  
  const sheetTechnicians = getTechnicians(row);
  console.log(`\nTechnicians from spreadsheet (${sheetTechnicians.length}): ${sheetTechnicians.join(', ') || 'None'}`);
  
  // Get technicians from the calendar event
  console.log(`\nEXAMINING TECHNICIANS IN CALENDAR EVENT:`);
  console.log(`Event description: "${existingEvent.description || '(no description)'}"`);
  
  const calendarTechnicians = extractTechniciansFromDescription(existingEvent.description);
  console.log(`Technicians from calendar (${calendarTechnicians.length}): ${calendarTechnicians.join(', ') || 'None'}`);
  
  // Compare the two lists
  console.log(`\nCOMPARING TECHNICIAN LISTS:`);
  
  // Check if lists have the same length
  const sameLength = sheetTechnicians.length === calendarTechnicians.length;
  console.log(`Lists have same length? ${sameLength}`);
  
  // Check if all sheet technicians exist in calendar
  const sheetTechsInCalendar = sheetTechnicians.every(tech => 
    calendarTechnicians.some(calTech => calTech.trim() === tech.trim())
  );
  console.log(`All sheet technicians exist in calendar? ${sheetTechsInCalendar}`);
  
  // Check if all calendar technicians exist in sheet
  const calendarTechsInSheet = calendarTechnicians.every(tech => 
    sheetTechnicians.some(sheetTech => sheetTech.trim() === tech.trim())
  );
  console.log(`All calendar technicians exist in sheet? ${calendarTechsInSheet}`);
  
  // Technicians need update if any of these checks fail
  const techniciansNeedUpdate = !sameLength || !sheetTechsInCalendar || !calendarTechsInSheet;
  console.log(`CONCLUSION: Technicians need update? ${techniciansNeedUpdate}`);
  
  // Check for cancellation flag
  const shouldCancel = row[18] === true || row[18] === "true" || row[18] === "TRUE";

  // Define eventName before using it
  const eventName = `${row[4] || ''} ${row[5] || ''}`.trim();

  
  // Create the new complete description with properly formatted technicians
  const newDescription = formatDescription(row);
  console.log(`\nNEW FORMATTED DESCRIPTION:`);
  console.log(newDescription);
  
  // Prepare the updated event data
  const updatedEventData = {
    summary: shouldCancel ? `Canceled: ${eventName}` : eventName,
    description: newDescription,
    location: row[6] || '',
    start: {
      dateTime: getStartDateTime(row, 1),
      timeZone: config.timezone || "Asia/Jerusalem",
    },
    end: {
      dateTime: getEndDateTime(row, 1),
      timeZone: config.timezone || "Asia/Jerusalem",
    },
    status: shouldCancel ? 'cancelled' : 'confirmed'
  };

  
  // Log reasons for changes
  const changes = [];
  if (existingEvent.summary !== updatedEventData.summary) changes.push('summary');
  if (existingEvent.description !== updatedEventData.description) changes.push('description');
  if (existingEvent.location !== updatedEventData.location) changes.push('location');
  if (existingEvent.start.dateTime !== updatedEventData.start.dateTime) changes.push('start time');
  if (existingEvent.end.dateTime !== updatedEventData.end.dateTime) changes.push('end time');
  if (existingEvent.status !== updatedEventData.status) changes.push('status');
  if (techniciansNeedUpdate) changes.push('technicians');
  
  console.log(`\nUPDATE REQUIRED: ${changes.length > 0 ? 'YES' : 'NO'}`);
  if (changes.length > 0) {
    console.log(`Changes needed: ${changes.join(', ')}`);
  }
  
  // If technicians need updating or any other changes are needed, update the entire event
  if (changes.length > 0 || techniciansNeedUpdate) {
    console.log(`\nUPDATING EVENT ${eventId} for row ${rowIndex}...`);
    
    try {
      // Update the event in the calendar
      await calendarService.events.update({
        calendarId: config.calendarId,
        eventId: eventId,
        resource: updatedEventData
      });
      
      console.log(`Event ${eventId} updated successfully!`);
      
      updatedEvents.push({
        rowIndex,
        eventId,
        summary: updatedEventData.summary,
        changes: changes,
        action: 'updated'
      });
      
      // If the event is cancelled, update the processed marker in the sheet
      if (shouldCancel && config.processedColumnIndex !== undefined) {
        // SPECIAL MANUAL FIX: Add +2 to rowIndex instead of +1 for the AK column
        const processedColumnIndex = config.processedColumnIndex;
        const specialSheetRowNum = rowIndex + 2; // Adding +2 instead of +1
        
        console.log(`=== CRITICAL DEBUG FOR AK COLUMN (CANCELLED) ===`);
        console.log(`Raw rowIndex: ${rowIndex}`);
        console.log(`MANUALLY APPLYING +2 TO ROWINDEX for CANCELLED status`);
        console.log(`Using sheet row ${specialSheetRowNum} (rowIndex + 2) for column AK`);
        console.log(`Regular conversion would use: ${rowIndex + 1}`);
        console.log(`=== END CRITICAL DEBUG ===`);
        
        // Add event to calendar
const calendarResponse = await calendarService.events.insert({
  calendarId: config.calendarId,
  resource: eventData,
});

console.log(`Created calendar event: ${calendarResponse.data.id}`);

// Use the fixed helper function to mark as processed and store event ID
await markRowAsProcessed(
  sheetService,
  config,
  i,  // Pass the current row index
  calendarResponse.data.id,
  shouldCancel
);
        console.log(`✓ SUCCESSFULLY MARKED ROW AK${specialSheetRowNum} AS CANCELLED`);
      }
      
    } catch (updateError) {
      console.error(`Error updating event ${eventId}: ${updateError.message}`);
      throw updateError;
    }
  } else {
    console.log(`No changes needed for event ${eventId}`);
  }
  
  console.log(`----- END OF ENHANCED UPDATE CHECK -----\n`);
}

/**
 * Extract technicians from event description
 * @param {string} description - The event description
 * @returns {Array} Array of technician names
 */
function extractTechniciansFromDescription(description) {
  let technicians = [];
  
  if (description) {
    try {
      // Use a more robust approach to extract technicians
      const parts = description.split('טכנאים משובצים:');
      if (parts.length > 1) {
        const techSection = parts[1];
        // Split by newline and filter out empty lines
        technicians = techSection.split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0);
        
        console.log(`Successfully extracted ${technicians.length} technicians from event description`);
        if (technicians.length > 0) {
          console.log(`Technicians from description: ${technicians.join(', ')}`);
        }
      } else {
        console.log(`No technician section found in event description`);
      }
    } catch (error) {
      console.error(`Error extracting technicians from description: ${error}`);
      // Default to empty array on error
      technicians = [];
    }
  } else {
    console.log(`Event has no description`);
  }
  
  return technicians;
}

/**
 * Check if a row is valid for processing
 * @param {Array} row - The row data
 * @param {number} rowIndex - The row index
 * @returns {boolean} Whether the row is valid
 */
function isValidRow(row, rowIndex) {
  // Skip empty rows or rows without date
  if (!row || !row[1]) {
    console.log(`Skipping row ${rowIndex}: No date found`);
    return false;
  }
  
  // Skip if date is not in DD/MM/YY format
  if (!row[1].match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
    console.log(`Row ${rowIndex} has no valid date in column B (format DD/MM/YY), skipping`);
    return false;
  }
  
  return true;
}

/**
 * Check if a row is already processed
 * @param {Array} row - The row data
 * @param {Object} config - The user's configuration
 * @returns {boolean} Whether the row is already processed
 */
function isAlreadyProcessed(row, config) {
  return config.processedColumnIndex && 
         row[config.processedColumnIndex] === config.processedMarker;
}

/**
 * Check if a row has an excluded event type
 * @param {Array} row - The row data
 * @returns {boolean} Whether the row has an excluded event type
 */
function isExcludedEventType(row) {
  const eventType = row[3] || '';
  return ["הצעת מחיר", "השכרות", "אופציה", "הפקה"].includes(eventType);
}

// ===== CLOUD FUNCTIONS =====

// Add a debug function to help the admin check event IDs
exports.debugEventIds = functions.https.onCall(async (data, context) => {
  // Authentication checks
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required"
    );
  }
  
  const userId = context.auth.uid;
  
  try {
    console.log("Starting event ID debug for user", userId);
    
    // Get user configuration
    const configDoc = await db.collection("configurations").doc(userId).get();
    
    if (!configDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Configuration not found");
    }
    
    const config = configDoc.data();
    
    // Setup API client
    console.log("Initializing service account auth");
    const jwtClient = new google.auth.JWT(
      serviceAccount.client_email,
      null,
      serviceAccount.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    
    // Authenticate request
    await jwtClient.authorize();
    console.log("Service account authenticated successfully");
    
    // Create API client
    const sheetService = google.sheets({version: 'v4', auth: jwtClient});
    
    // Get the event ID column info
    const eventIdColumnIndex = config.eventIdColumnIndex !== undefined ? 
                               config.eventIdColumnIndex : 37; // Default to column AL
    
    const columnLetter = getColumnLetter(eventIdColumnIndex);
    
    // Log event IDs
    await logAllEventIds(sheetService, config);
    
    return {
      success: true,
      message: `Checked event IDs in column ${columnLetter} (index ${eventIdColumnIndex})`,
      columnInfo: {
        index: eventIdColumnIndex,
        letter: columnLetter
      }
    };
    
  } catch (error) {
    console.error("Error in debugEventIds:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});


exports.manualScan = functions.https.onCall(async (data, context) => {
  // Authentication checks
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required"
    );
  }
  
  const userId = context.auth.uid;
  
  try {
    console.log("Starting manual scan for user", userId, "with options:", data);
    
    // Get user configuration
    const configDoc = await db.collection("configurations").doc(userId).get();
    
    if (!configDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Configuration not found");
    }
    
    const config = configDoc.data();
    console.log("Found configuration:", {
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName, 
      calendarId: config.calendarId,
      lastProcessedRow: config.lastProcessedRow,
      processedColumnIndex: config.processedColumnIndex,
      eventIdColumnIndex: config.eventIdColumnIndex,
      dataRange: config.dataRange
    });
    
    // Reset lastProcessedRow if requested
    if (data && data.resetProcessed) {
      await db.collection("configurations").doc(userId).update({
        lastProcessedRow: 2, // Start at row 2 (index 1) to skip header
      });
      console.log("Reset lastProcessedRow to 2 for user", userId);

      // Update local config
      config.lastProcessedRow = 2;
    }
    
    // Use service account for authentication
    console.log("Initializing service account auth");
    const jwtClient = new google.auth.JWT(
      serviceAccount.client_email,
      null,
      serviceAccount.private_key,
      [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/calendar'
      ]
    );
    
    // Authenticate request
    await jwtClient.authorize();
    console.log("Service account authenticated successfully");
    
    // Create API clients
    const sheetService = google.sheets({version: 'v4', auth: jwtClient});
    const calendarService = google.calendar({version: 'v3', auth: jwtClient});
    
    // Read from Google Sheet
    console.log(`Reading sheet ${config.sheetName} from spreadsheet ${config.spreadsheetId}`);
    const dataRange = config.dataRange || "A1:AZ1000"; // Default range if not specified
    const sheetResponse = await sheetService.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `${config.sheetName}!${dataRange}`,
    });
    
    const allRows = sheetResponse.data.values || [];
    console.log(`Found ${allRows.length} total rows in sheet`);
    
    // Get last processed row ID
    let lastProcessedRow = config.lastProcessedRow || 0;
    
    // Make sure we start at at least row 2 (index 1) to skip headers
    if (lastProcessedRow < 2) {
      lastProcessedRow = 2;
      console.log("Adjusted lastProcessedRow to 2 to skip headers");
    }
    
    // Check if we're at the end of the sheet
    if (lastProcessedRow >= allRows.length) {
      console.log("No more rows to process");
      
      // Create a log entry
      const logRef = await db.collection("processingLogs").add({
        userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        manualScan: true,
        resetProcessed: data.resetProcessed || false,
        message: "No more rows to process",
        lastProcessedRow
      });
      
      return {
        success: false,
        message: "No more rows to process",
        lastProcessedRow
      };
    }
    
    // Tracking for processed events
    const processedEvents = [];
    const updatedEvents = [];
    const errors = [];
    
    // Processing a single row at a time for simpler debugging
    // This will process the current lastProcessedRow and then advance it by one
    console.log(`Processing row at index ${lastProcessedRow}`);
    
    try {
      const row = allRows[lastProcessedRow];
      console.log("Row data:", JSON.stringify(row));
      
      // Skip if row is empty or doesn't have enough data
      if (!row || row.length < 10) {
        console.log(`Row ${lastProcessedRow} is empty or incomplete, skipping`);
        
        // Update the lastProcessedRow in the configuration
        await db.collection("configurations").doc(userId).update({
          lastProcessedRow: lastProcessedRow + 1,
          lastScanTime: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Create a log entry
        const logRef = await db.collection("processingLogs").add({
          userId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          manualScan: true,
          message: "Row skipped: Insufficient data",
          rowIndex: lastProcessedRow
        });
        
        return {
          success: true,
          message: "Row skipped: Insufficient data",
          rowIndex: lastProcessedRow,
          advancedToNextRow: true
        };
      }
      
      // Skip if no valid date in column B (index 1)
      if (!row[1] || !row[1].match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
        console.log(`Row ${lastProcessedRow} has no valid date in column B, skipping`);
        
        // Update the lastProcessedRow in the configuration
        await db.collection("configurations").doc(userId).update({
          lastProcessedRow: lastProcessedRow + 1,
          lastScanTime: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Create a log entry
        const logRef = await db.collection("processingLogs").add({
          userId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          manualScan: true,
          message: "Row skipped: No valid date",
          rowIndex: lastProcessedRow
        });
        
        return {
          success: true,
          message: "Row skipped: No valid date found",
          rowIndex: lastProcessedRow,
          advancedToNextRow: true
        };
      }
      
      // Skip if event type is in the excluded list (column D, index 3)
      const eventType = row[3] || '';
      const isExcludedType = ["הצעת מחיר", "השכרות", "אופציה", "הפקה"].includes(eventType);

      if (isExcludedType) {
        console.log(`Skipping row ${lastProcessedRow} with excluded event type: ${eventType}`);
        
        // Update the lastProcessedRow in the configuration
        await db.collection("configurations").doc(userId).update({
          lastProcessedRow: lastProcessedRow + 1,
          lastScanTime: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Create a log entry
        const logRef = await db.collection("processingLogs").add({
          userId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          manualScan: true,
          message: `Row skipped: Event type "${eventType}" is excluded`,
          rowIndex: lastProcessedRow
        });
        
        return {
          success: true,
          message: `Row skipped: Event type "${eventType}" is excluded`,
          rowIndex: lastProcessedRow,
          advancedToNextRow: true
        };
      }
      
      // Check if already processed and has an event ID
      const isProcessed = config.processedColumnIndex && 
                         row[config.processedColumnIndex] === config.processedMarker;
      const hasEventId = config.eventIdColumnIndex && row[config.eventIdColumnIndex];
      console.log(`Row status: isProcessed=${isProcessed}, hasEventId=${hasEventId}`);
      
      // Format the event data including detailed technician list
      const dateStr = row[1]; // Date in column B (index 1)
      const startTime = row[9] || '17:00'; // Start time (column J)
      const endTime = row[10] || '20:00'; // End time (column K)
      
      console.log(`Event date/time: ${dateStr}, ${startTime}-${endTime}`);
      
      // Format the technician list - enhanced version
      console.log(`Examining technicians in row ${lastProcessedRow}:`);
      const techniciansList = getTechnicians(row);
      
      // Generate complete description with technicians
      const eventDescription = formatDescription(row);
      console.log(`Generated description: ${eventDescription}`);
      
      // Prepare complete event data
      const eventData = {
        summary: `${row[4] || ''} ${row[5] || ''}`.trim(), // Columns E+F for event name
        description: eventDescription, // This includes the formatted technician list
        location: row[6] || '', // Column G for location
        start: {
          dateTime: formatDateTimeWithTZ(dateStr, startTime),
          timeZone: config.timezone || "Asia/Jerusalem",
        },
        end: {
          dateTime: formatDateTimeWithTZ(dateStr, endTime),
          timeZone: config.timezone || "Asia/Jerusalem",
        }
      };
      
      // Check for cancellation flag (column S, index 18)
      const shouldCancel = row[18] === true || row[18] === "true" || row[18] === "TRUE";
      const eventName = `${row[4] || ''} ${row[5] || ''}`.trim();
      
      if (shouldCancel) {
        console.log(`Row ${lastProcessedRow} marked for cancellation`);
        eventData.status = 'cancelled';
      } else {
        eventData.status = 'confirmed';
      }
      
      // If already processed with event ID, check for changes and update
      if (isProcessed && hasEventId && !data.resetProcessed) {
        console.log(`\n----- CHECKING FOR UPDATES TO EXISTING EVENT -----`);
        
        // Use the enhanced update function with fixed row handling
        await checkAndUpdateEventEnhanced(
          sheetService,
          calendarService,
          config,
          row,
          lastProcessedRow,
          updatedEvents
        );
        
        // Update the lastProcessedRow in the configuration to advance to next row
        await db.collection("configurations").doc(userId).update({
          lastProcessedRow: lastProcessedRow + 1,
          lastScanTime: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return {
          success: true,
          message: updatedEvents.length > 0 ? "Updated existing event" : "No changes needed",
          rowIndex: lastProcessedRow,
          updatedEvents,
          advancedToNextRow: true
        };
        
      } else {
        // Create a new event
        console.log(`Creating new event for row ${lastProcessedRow}`);
        
        // Add event to calendar
        const calendarResponse = await calendarService.events.insert({
          calendarId: config.calendarId,
          resource: eventData,
        });
        
        console.log(`Created new event: ${calendarResponse.data.id}`);
        
        // FIXED: Use the proper functions to mark as processed and store event ID
        // Correctly calculate the sheet row number and mark as processed
        const rowToUpdate = lastProcessedRow; // Keep the 0-based index for function calls
        const sheetRowNum = getValidSheetRowNum(rowToUpdate);
        
        console.log(`Marking row ${sheetRowNum} as processed (from index ${rowToUpdate})`);
        
        // Use the fixed markRowAsProcessed function
        await markRowAsProcessed(
          sheetService,
          config,
          rowToUpdate,
          calendarResponse.data.id,
          shouldCancel
        );
        
        processedEvents.push({
          rowIndex: lastProcessedRow,
          eventId: calendarResponse.data.id,
          summary: eventData.summary,
          action: 'created'
        });
        
        // Always advance to the next row
        await db.collection("configurations").doc(userId).update({
          lastProcessedRow: lastProcessedRow + 1,
          lastScanTime: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Advanced to next row: ${lastProcessedRow + 1}`);
        
        // Log processing results
        const logRef = await db.collection("processingLogs").add({
          userId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          manualScan: true,
          processedEvents,
          updatedEvents,
          errors,
          rowsScanned: 1
        });
        console.log(`Created log entry: ${logRef.id}`);
        
        return {
          success: true,
          message: "Created new event",
          rowIndex: lastProcessedRow,
          processedEvents,
          advancedToNextRow: true
        };
      }
      
    } catch (error) {
      console.error(`Error processing row ${lastProcessedRow}:`, error);
      
      // Log error
      const logRef = await db.collection("processingLogs").add({
        userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        errors: [{
          rowIndex: lastProcessedRow,
          error: error.message
        }],
        rowsScanned: 1
      });
      
      return {
        success: false,
        message: `Error processing row: ${error.message}`,
        rowIndex: lastProcessedRow,
        error: error.message
      };
    }
  } catch (error) {
    console.error("Error in manualScan:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

// Debug function to process a single row
exports.processSingleRow = functions.https.onCall(async (data, context) => {
  // Authentication checks remain the same
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required",
    );
  }
  
  const userId = context.auth.uid;
  console.log(`Processing single row for user ${userId}`);
  
  try {
    // Get user configuration
    const configDoc = await db.collection("configurations").doc(userId).get();
    
    if (!configDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "Configuration not found",
      );
    }
    
    const config = configDoc.data();
    
    // Use service account instead of user credentials
    console.log("Initializing service account auth");
    
    // Create a JWT client using service account
    const jwtClient = new google.auth.JWT(
      serviceAccount.client_email,
      null,
      serviceAccount.private_key,
      [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/calendar'
      ]
    );
    
    // Authenticate request
    await jwtClient.authorize();
    console.log("Service account authenticated successfully");
    
    // Create API clients
    const sheetService = google.sheets({version: 'v4', auth: jwtClient});
    const calendarService = google.calendar({version: 'v3', auth: jwtClient});
    
    // Get last processed row ID
    let lastProcessedRow = config.lastProcessedRow || 0;
    
    // Make sure we start at at least row 2 (index 1) to skip headers
    if (lastProcessedRow < 2) {
      lastProcessedRow = 2;
      console.log("Adjusted lastProcessedRow to 2 to skip headers");
    }
    
    // Read from Google Sheet
    console.log(`Reading sheet ${config.sheetName} from spreadsheet ${config.spreadsheetId}`);
    const sheetResponse = await sheetService.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `${config.sheetName}!${config.dataRange}`,
    });
    
    const rows = sheetResponse.data.values || [];
    console.log(`Found ${rows.length} total rows in sheet`);
    
    // Check if there are more rows to process
    if (lastProcessedRow >= rows.length) {
      return {
        success: false, 
        message: "No more rows to process",
        rowIndex: lastProcessedRow
      };
    }
    
    // Process just the next row
    const rowIndex = lastProcessedRow;
    const row = rows[rowIndex];
    const processedEvents = [];
    const errors = [];
    
    try {
      // Skip if row is empty or doesn't have enough data
      if (!row || row.length < 10) {
        console.log(`Row ${rowIndex} is empty or incomplete, skipping`);
        
        // Update the lastProcessedRow in the configuration
        await db.collection("configurations").doc(userId).update({
          lastProcessedRow: lastProcessedRow + 1,
          lastScanTime: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return {
          success: true,
          message: "Row skipped: Insufficient data",
          rowIndex: rowIndex,
          rowData: row,
          advancedToNextRow: true
        };
      }
      
      // Skip if no valid date in column B (index 1)
      if (!row[1] || !row[1].match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
        console.log(`Row ${rowIndex} has no valid date in column B, skipping`);
        
        // Update the lastProcessedRow in the configuration
        await db.collection("configurations").doc(userId).update({
          lastProcessedRow: lastProcessedRow + 1,
          lastScanTime: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return {
          success: true,
          message: "Row skipped: No valid date found",
          rowIndex: rowIndex,
          rowData: row,
          advancedToNextRow: true
        };
      }
      
      // Check if already processed and has an event ID - might need update
      const isProcessed = config.processedColumnIndex && 
                         row[config.processedColumnIndex] === config.processedMarker;
      const hasEventId = config.eventIdColumnIndex && row[config.eventIdColumnIndex];
      
      // Skip if event type is in the excluded list
      const eventType = row[3] || '';
      const isExcludedType = ["הצעת מחיר", "השכרות", "אופציה", "הפקה"].includes(eventType);
      
      if (isExcludedType) {
        console.log(`Skipping row ${rowIndex} with excluded event type: ${eventType}`);
        return; // Don't process these at all

        // Update the lastProcessedRow in the configuration
        await db.collection("configurations").doc(userId).update({
          lastProcessedRow: lastProcessedRow + 1,
          lastScanTime: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return {
          success: true,
          message: `Row skipped: Event type "${eventType}" is excluded`,
          rowIndex: rowIndex,
          rowData: row,
          advancedToNextRow: true
        };
      }
      
      // Check for cancellation flag
      const shouldCancel = row[18] === true || row[18] === "true" || row[18] === "TRUE";
      const eventName = `${row[4] || ''} ${row[5] || ''}`.trim();
      
      // Prepare calendar event data
      const eventData = {
        summary: shouldCancel ? `Canceled: ${eventName}` : eventName,
        description: formatDescription(row),
        location: row[6] || '', // Column G for location
        start: {
          dateTime: getStartDateTime(row, 1), // Date in column B (index 1)
          timeZone: config.timezone || "Asia/Jerusalem",
        },
        end: {
          dateTime: getEndDateTime(row, 1), // Date in column B (index 1)
          timeZone: config.timezone || "Asia/Jerusalem",
        },
        status: shouldCancel ? 'cancelled' : 'confirmed'
      };

            // Check for cancellation flag
      if (shouldCancel) {
        eventData.status = 'cancelled';
      }
      
      // If already processed and has event ID, update the event
      if (isProcessed && hasEventId) {
        console.log(`Row ${rowIndex} already has event ID ${row[config.eventIdColumnIndex]}, checking for updates`);
        
        try {
          // Get the existing event
          const eventResponse = await calendarService.events.get({
            calendarId: config.calendarId,
            eventId: row[config.eventIdColumnIndex]
          });
          
          const existingEvent = eventResponse.data;
          
          // Check if any data has changed
          const hasChanges = 
            existingEvent.summary !== eventData.summary ||
            existingEvent.description !== eventData.description ||
            existingEvent.location !== eventData.location ||
            existingEvent.start.dateTime !== eventData.start.dateTime ||
            existingEvent.end.dateTime !== eventData.end.dateTime ||
            existingEvent.status !== eventData.status;
          
          if (hasChanges) {
            // Update the event
            await calendarService.events.update({
              calendarId: config.calendarId,
              eventId: row[config.eventIdColumnIndex],
              resource: eventData
            });
            
            console.log(`Updated existing calendar event: ${row[config.eventIdColumnIndex]}`);
            
            // Mark as UPDATED in the log but don't change the processed marker
            if (shouldCancel && config.processedColumnIndex !== undefined) {
              await sheetService.spreadsheets.values.update({
                spreadsheetId: config.spreadsheetId,
                range: `${config.sheetName}!${getColumnLetter(config.processedColumnIndex)}${rowIndex + 1}`,
                valueInputOption: "RAW",
                resource: {
                  values: [["CANCELLED"]]
                },
              });
            }
            
            // Update the lastProcessedRow in the configuration
            await db.collection("configurations").doc(userId).update({
              lastProcessedRow: lastProcessedRow + 1,
              lastScanTime: admin.firestore.FieldValue.serverTimestamp()
            });
            
            return {
              success: true,
              message: "Updated existing calendar event",
              rowIndex: rowIndex,
              rowData: row,
              eventUpdated: {
                id: row[config.eventIdColumnIndex],
                summary: eventData.summary,
                changes: hasChanges
              },
              advancedToNextRow: true
            };
          } else {
            console.log(`No changes detected for event ${row[config.eventIdColumnIndex]}`);
            
            // Update the lastProcessedRow in the configuration
            await db.collection("configurations").doc(userId).update({
              lastProcessedRow: lastProcessedRow + 1,
              lastScanTime: admin.firestore.FieldValue.serverTimestamp()
            });
            
            return {
              success: true,
              message: "No changes detected for existing event",
              rowIndex: rowIndex,
              rowData: row,
              advancedToNextRow: true
            };
          }
        } catch (getError) {
          console.error(`Error getting existing event: ${getError}`);
          
          // Event might have been deleted in the calendar - create a new one
          console.log(`Existing event not found in calendar, creating new event`);
          
          // Continue to create a new event below
        }
      }
      
      // If row is marked for cancellation, create a cancelled event or update existing
      if (shouldCancel) {
        console.log(`Row ${rowIndex} marked for cancellation`);
        
        // If there's an existing event ID stored in the row, update its status to cancelled
        if (hasEventId) {
          try {
            // First get the current event
            const eventResponse = await calendarService.events.get({
              calendarId: config.calendarId,
              eventId: row[config.eventIdColumnIndex]
            });
            
            const existingEvent = eventResponse.data;
            
            // Update the event status to cancelled while preserving all other properties
            existingEvent.status = 'cancelled';
            
            // Update the event in the calendar
            await calendarService.events.update({
              calendarId: config.calendarId,
              eventId: row[config.eventIdColumnIndex],
              resource: existingEvent
            });
            
            console.log(`Marked event as cancelled in calendar: ${row[config.eventIdColumnIndex]}`);
            
            // Mark as cancelled in the spreadsheet
            if (config.updateProcessedStatus && config.processedColumnIndex !== undefined) {
              await sheetService.spreadsheets.values.update({
                spreadsheetId: config.spreadsheetId,
                range: `${config.sheetName}!${getColumnLetter(config.processedColumnIndex)}${rowIndex + 1}`,
                valueInputOption: "RAW",
                resource: {
                  values: [["CANCELLED"]]
                },
              });
            }
          } catch (updateError) {
            console.error(`Error updating event status: ${updateError}`);
            
            return {
              success: false,
              message: `Failed to cancel event: ${updateError.message}`,
              rowIndex: rowIndex,
              rowData: row
            };
          }
        } else {
          // Create new cancelled event
          try {
            // Add event to calendar with cancelled status
            const calendarResponse = await calendarService.events.insert({
              calendarId: config.calendarId,
              resource: eventData
            });
            
            console.log(`Created cancelled calendar event: ${calendarResponse.data.htmlLink}`);
            
            // Mark as cancelled in the spreadsheet
            if (config.updateProcessedStatus && config.processedColumnIndex !== undefined) {
              await sheetService.spreadsheets.values.update({
                spreadsheetId: config.spreadsheetId,
                range: `${config.sheetName}!${getColumnLetter(config.processedColumnIndex)}${rowIndex + 1}`,
                valueInputOption: "RAW",
                resource: {
                  values: [["CANCELLED"]]
                },
              });
            }
            
            // Store event ID if configured
            if (config.eventIdColumnIndex !== undefined) {
              await sheetService.spreadsheets.values.update({
                spreadsheetId: config.spreadsheetId,
                range: `${config.sheetName}!${getColumnLetter(config.eventIdColumnIndex)}${rowIndex + 1}`,
                valueInputOption: "RAW",
                resource: {
                  values: [[calendarResponse.data.id]]
                },
              });
            }
          } catch (createError) {
            console.error(`Error creating cancelled event: ${createError}`);
            return {
              success: false,
              message: `Failed to create cancelled event: ${createError.message}`,
              rowIndex: rowIndex,
              rowData: row
            };
          }
        }
        
        // Update the lastProcessedRow in the configuration
        await db.collection("configurations").doc(userId).update({
          lastProcessedRow: lastProcessedRow + 1,
          lastScanTime: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return {
          success: true,
          message: "Event marked as cancelled in the calendar",
          rowIndex: rowIndex,
          rowData: row,
          cancelled: true,
          advancedToNextRow: true
        };
      }
      
      // Create a new event if not cancelled and not already existing
      console.log(`Creating new event for row ${rowIndex}`);
      
      // Add event to calendar
      const calendarResponse = await calendarService.events.insert({
        calendarId: config.calendarId,
        resource: eventData
      });
      
      console.log(`Created calendar event: ${calendarResponse.data.htmlLink}`);
      
      // Mark as processed in the spreadsheet if configured
      if (config.updateProcessedStatus && config.processedColumnIndex !== undefined) {
        await sheetService.spreadsheets.values.update({
          spreadsheetId: config.spreadsheetId,
          range: `${config.sheetName}!${getColumnLetter(config.processedColumnIndex)}${rowIndex + 1}`,
          valueInputOption: "RAW",
          resource: {
            values: [[config.processedMarker || "PROCESSED"]]
          },
        });
        
        // Store the event ID if configured
        if (config.eventIdColumnIndex !== undefined) {
          // Use this single call:
        await markRowAsProcessed(
          sheetService,
          config,
          i,  // Pass the row index
          calendarResponse.data.id,
          shouldCancel
        );
        }
      }
      
      // Update the lastProcessedRow in the configuration
      await db.collection("configurations").doc(userId).update({
        lastProcessedRow: lastProcessedRow + 1,
        lastScanTime: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Log processing results
      await db.collection("processingLogs").add({
        userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        processedEvents: [{
          rowIndex,
          eventId: calendarResponse.data.id,
          summary: eventData.summary
        }],
        errors,
        rowsScanned: 1,
        debugMode: true
      });
      
      return {
        success: true,
        message: "Processed one row successfully",
        rowIndex: rowIndex,
        rowData: row,
        parsedStartTime: eventData.start.dateTime,
        parsedEndTime: eventData.end.dateTime,
        eventCreated: {
          id: calendarResponse.data.id,
          summary: eventData.summary,
          link: calendarResponse.data.htmlLink
        }
      };
      
    } catch (error) {
      console.error(`Error processing row ${rowIndex}:`, error);
      errors.push({
        rowIndex,
        error: error.message
      });
      
      // Log error
      await db.collection("processingLogs").add({
        userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        processedEvents: [],
        errors,
        rowsScanned: 1,
        debugMode: true
      });
      
      return {
        success: false,
        message: `Error processing row: ${error.message}`,
        rowIndex: rowIndex,
        rowData: row
      };
    }
  } catch (error) {
    console.error('Error in processSingleRow:', error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

// API endpoint to save configuration
exports.saveConfiguration = functions.https.onCall(async (data, context) => {
  // Check authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required",
    );
  }
  
  // Check domain
  const email = context.auth.token.email || "";
  if (!email.endsWith("@hakolsound.co.il")) {
    throw new functions.https.HttpsError(
        "permission-denied",
        "Only hakolsound.co.il organization members allowed",
    );
  }
  
  const userId = context.auth.uid;
  
  try {
    // Validate required fields
    if (!data.spreadsheetId || !data.sheetName || !data.calendarId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing required configuration fields",
      );
    }
    
    // Ensure lastProcessedRow is at least 3 to skip headers
    if (!data.lastProcessedRow || data.lastProcessedRow < 3) {
      data.lastProcessedRow = 3;
    }
    
    // Save the configuration
    await db.collection("configurations").doc(userId).set(data, {merge: true});
    
    return {success: true};
  } catch (error) {
    console.error("Error in saveConfiguration:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

// API endpoint to get logs
exports.getLogs = functions.https.onCall(async (data, context) => {
  // Check authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required",
    );
  }
  
  // Check domain
  const email = context.auth.token.email || "";
  if (!email.endsWith("@hakolsound.co.il")) {
    throw new functions.https.HttpsError(
        "permission-denied",
        "Only hakolsound.co.il organization members allowed",
    );
  }
  
  const userId = context.auth.uid;
  const limit = data.limit || 20;
  
  try {
    // Get logs for the user
    const logsSnapshot = await db.collection("processingLogs")
        .where("userId", "==", userId)
        .orderBy("timestamp", "desc")
        .limit(limit)
        .get();
    
    const logs = [];
    logsSnapshot.forEach((doc) => {
      logs.push({
        id: doc.id,
        ...doc.data(),
      });
    });
    
    return {logs};
  } catch (error) {
    console.error("Error in getLogs:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

// Preview sheet data for the UI
exports.getSheetPreview = functions.https.onCall(async (data, context) => {
  try {
    console.log("Initializing service account auth");
    
    const jwtClient = new google.auth.JWT(
      serviceAccount.client_email,
      null,
      serviceAccount.private_key,
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    
    await jwtClient.authorize();
    const sheetsApi = google.sheets({version: 'v4', auth: jwtClient});
    
    // Get spreadsheet data - include all columns from A to AZ to capture technicians
    console.log("Fetching spreadsheet data");
    const sheetResponse = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: "1p3XgwnFOb6lxaAo0ysZH-prVNggOgksH-FE8clEoO1U",
      range: "This Year!A3:AZ200" // Get more rows with all columns
    });
    
    const rows = sheetResponse.data.values || [];
    console.log(`Found ${rows.length} rows for preview`);
    
    // Get today's date for filtering
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Filter for rows with valid future dates
    const futureEvents = rows.filter(row => {
      // Check if we have a valid date in column B (index 1)
      if (!row || row.length < 2 || !row[1] || !row[1].match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
        return false;
      }
      
      // Parse the date
      try {
        const dateParts = row[1].split('/');
        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1; // 0-based month
        const year = 2000 + parseInt(dateParts[2], 10);
        
        const eventDate = new Date(year, month, day);
        eventDate.setHours(0, 0, 0, 0);
        
        // Keep only future dates (today or later)
        return eventDate >= today;
      } catch (e) {
        console.error("Error parsing date:", e);
        return false;
      }
    });
    
    console.log(`Found ${futureEvents.length} future events`);
    
    // Sort by date
    futureEvents.sort((a, b) => {
      const dateA = parseDate(a[1]);
      const dateB = parseDate(b[1]);
      return dateA - dateB;
    });
    
    // Format for display with enhanced data
    const formattedEvents = futureEvents.slice(0, 20).map(row => {
      // Extract technicians from columns U-AA (indices 20-26)
      const technicians = [];
      for (let i = 20; i <= 26; i++) {
        if (row[i] && row[i].trim()) {
          technicians.push(row[i].trim());
        }
      }
      
      // Log technicians found for debugging
      if (technicians.length > 0) {
        console.log(`Found ${technicians.length} technicians for event on ${row[1]}: ${technicians.join(', ')}`);
      }
      
      return {
        date: row[1] || '',
        day: row[2] || '',
        eventTypeD: row[3] || '', // Event type from column D
        eventType: row[4] || '',  // Original eventType from column E
        title: row[5] || '',
        location: row[6] || '',
        fee: row[7] || '',
        notes: row[8] || '',
        startTime: row[9] || '17:00',
        endTime: row[10] || '20:00',
        manager: row[11] || '',
        technicians: technicians
      };
    });
    
    // Count events per day for statistics
    const eventsByDate = {};
    formattedEvents.forEach(event => {
      if (!eventsByDate[event.date]) {
        eventsByDate[event.date] = [];
      }
      eventsByDate[event.date].push(event);
    });
    
    // Get total count of events per date
    const dateStats = Object.keys(eventsByDate).map(date => ({
      date,
      count: eventsByDate[date].length
    }));
    
    return {
      success: true,
      rows: formattedEvents,
      dateStats: dateStats,
      futureCount: futureEvents.length
    };
  } catch (error) {
    console.error("Error in getSheetPreview:", error);
    return {
      success: false,
      error: error.message
    };
  }
});


// Add this new scan function that specifically checks all rows regardless of lastProcessedRow
exports.scanAllRowsForUpdates = functions.https.onCall(async (data, context) => {
  // Authentication checks
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required"
    );
  }
  
  const userId = context.auth.uid;
  
  try {
    console.log("Starting full update scan for user", userId);
    
    // Get user configuration
    const configDoc = await db.collection("configurations").doc(userId).get();
    
    if (!configDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Configuration not found");
    }
    
    const config = configDoc.data();
    console.log("Found configuration:", {
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName, 
      calendarId: config.calendarId,
      eventIdColumnIndex: config.eventIdColumnIndex || 37, // Default to AL
      dataRange: config.dataRange
    });
    
    // Use service account for authentication
    console.log("Initializing service account auth");
    const jwtClient = new google.auth.JWT(
      serviceAccount.client_email,
      null,
      serviceAccount.private_key,
      [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/calendar'
      ]
    );
    
    // Authenticate request
    await jwtClient.authorize();
    console.log("Service account authenticated successfully");
    
    // Create API clients
    const sheetService = google.sheets({version: 'v4', auth: jwtClient});
    const calendarService = google.calendar({version: 'v3', auth: jwtClient});
    
    // Create rate limiter for Google Sheets API
    const sheetsRateLimiter = new RateLimiter(40); // Limit to 40 requests per minute
    
    // Read from Google Sheet - ensure we get all columns
    console.log(`Reading sheet ${config.sheetName} from spreadsheet ${config.spreadsheetId}`);
    const dataRange = config.dataRange || "A1:AZ1000"; // Default range if not specified
    const sheetResponse = await sheetsRateLimiter.enqueue(async () => {
      return await sheetService.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range: `${config.sheetName}!${dataRange}`,
      });
    });
    
    const allRows = sheetResponse.data.values || [];
    console.log(`Found ${allRows.length} total rows in sheet`);
    
    // Tracking for processing results
    const updatedEvents = [];
    const skippedRows = [];
    const errors = [];
    const pendingUpdates = []; // For batch updates
    
    // The eventIdColumnIndex is either from config or defaults to column AL (index 37)
    const eventIdColumnIndex = config.eventIdColumnIndex !== undefined ? 
                              config.eventIdColumnIndex : 37;
    
    console.log(`\n===== SCANNING ALL ROWS FOR EVENT IDS =====`);
    console.log(`Using column ${getColumnLetter(eventIdColumnIndex)} (index ${eventIdColumnIndex}) for event IDs`);
    
    // SCAN PHASE: Check ALL rows with event IDs for updates
    console.log("\n----- CHECKING ALL ROWS FOR UPDATES -----");
    let rowsWithEventIds = 0;
    let rowsCheckedForUpdate = 0;
    let rowsUpdated = 0;
    
    // Process rows in smaller batches to prevent memory issues
    const BATCH_SIZE = 10;
    let currentBatch = [];
    
    for (let i = 2; i < allRows.length; i++) {  // Start from row 2 (index 1) to skip header
      const row = allRows[i];
      
      try {
        // Skip empty rows
        if (!row || row.length < 10) {
          skippedRows.push({ row: i, reason: "insufficient data" });
          continue;
        }
        
        // Skip rows without event IDs
        if (!row[eventIdColumnIndex]) {
          // Only log this for rows that should have an event ID
          if (row[1] && row[1].match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
            console.log(`Row ${i} has a valid date but no event ID - needs processing`);
          }
          continue;
        }
        
        rowsWithEventIds++;
        
        // Skip invalid rows - must have a valid date
        if (!row[1] || !row[1].match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
          console.log(`Row ${i} has an event ID but no valid date, skipping update check`);
          skippedRows.push({ row: i, reason: "no valid date" });
          continue;
        }
        
        rowsCheckedForUpdate++;
        
        // Add to current batch for processing
        currentBatch.push({ row, rowIndex: i });
        
        // Process batch when it reaches the batch size
        if (currentBatch.length >= BATCH_SIZE) {
          const batchResults = await processBatchUpdates(
            sheetService,
            calendarService,
            config,
            currentBatch,
            eventIdColumnIndex,
            updatedEvents,
            errors,
            sheetsRateLimiter
          );
          
          rowsUpdated += batchResults.updated;
          currentBatch = []; // Clear the batch
        }
      } catch (error) {
        console.error(`Error preparing row ${i} for batch update:`, error);
        errors.push({
          rowIndex: i,
          error: error.message
        });
      }
    }
    
    // Process any remaining rows in the final batch
    if (currentBatch.length > 0) {
      const batchResults = await processBatchUpdates(
        sheetService,
        calendarService,
        config,
        currentBatch,
        eventIdColumnIndex,
        updatedEvents,
        errors,
        sheetsRateLimiter
      );
      
      rowsUpdated += batchResults.updated;
    }
    
    // Log processing results
    await db.collection("processingLogs").add({
      userId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      scanType: "full-update-scan",
      updatedEvents,
      skippedRows,
      errors,
      stats: {
        totalRows: allRows.length,
        rowsWithEventIds,
        rowsCheckedForUpdate,
        rowsUpdated,
        errorCount: errors.length
      }
    });
    
    console.log(`\n===== SCAN COMPLETED =====`);
    console.log(`Found ${rowsWithEventIds} rows with event IDs`);
    console.log(`Checked ${rowsCheckedForUpdate} rows for updates`);
    console.log(`Updated ${rowsUpdated} events`);
    console.log(`Encountered ${errors.length} errors`);
    
    return {
      success: true,
      message: `Scan completed. Updated ${rowsUpdated} events.`,
      stats: {
        totalRows: allRows.length,
        rowsWithEventIds,
        rowsCheckedForUpdate,
        rowsUpdated,
        errorCount: errors.length
      }
    };
    
  } catch (error) {
    console.error("Error in scanAllRowsForUpdates:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

/**
 * Scheduled version of scanAllRowsForUpdates
 * Runs every 15 minutes to ensure all calendar events stay in sync
 * Scans events from today-7days to the end of the spreadsheet
 */
exports.scheduledScanAllRowsForUpdates = onSchedule({
  schedule: 'every 15 minutes',
  region: 'us-central1',
  timeZone: 'Asia/Jerusalem'
}, async (_context) => {
  try {
    console.log("Starting scheduled full update scan for all users");
    
    // Get all user configurations
    const configsSnapshot = await db.collection("configurations").get();
    
    for (const configDoc of configsSnapshot.docs) {
      const config = configDoc.data();
      const userId = configDoc.id;
      
      // Skip disabled configurations
      if (!config.enabled) {
        console.log(`Configuration ${configDoc.id} is disabled, skipping`);
        continue;
      }
      
      try {
        console.log(`Running full update scan for user ${userId}`);
        
        // Use service account for authentication
        console.log("Initializing service account auth");
        const jwtClient = new google.auth.JWT(
          serviceAccount.client_email,
          null,
          serviceAccount.private_key,
          [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/calendar'
          ]
        );
        
        // Authenticate request
        await jwtClient.authorize();
        console.log("Service account authenticated successfully");
        
        // Create API clients
        const sheetService = google.sheets({version: 'v4', auth: jwtClient});
        const calendarService = google.calendar({version: 'v3', auth: jwtClient});
        
        // Create rate limiter for Google Sheets API
        const sheetsRateLimiter = new RateLimiter(40); // Limit to 40 requests per minute
        
        // Read from Google Sheet - ensure we get all columns
        console.log(`Reading sheet ${config.sheetName} from spreadsheet ${config.spreadsheetId}`);
        const dataRange = config.dataRange || "A1:AZ1000"; // Default range if not specified
        const sheetResponse = await sheetsRateLimiter.enqueue(async () => {
          return await sheetService.spreadsheets.values.get({
            spreadsheetId: config.spreadsheetId,
            range: `${config.sheetName}!${dataRange}`,
          });
        });
        
        const allRows = sheetResponse.data.values || [];
        console.log(`Found ${allRows.length} total rows in sheet`);
        
        // Tracking for processing results
        const updatedEvents = [];
        const skippedRows = [];
        const errors = [];
        
        // The eventIdColumnIndex is either from config or defaults to column AL (index 37)
        const eventIdColumnIndex = config.eventIdColumnIndex !== undefined ? 
                                 config.eventIdColumnIndex : 37;
        
        console.log(`\n===== SCANNING ALL ROWS FOR EVENT IDS (user: ${userId}) =====`);
        console.log(`Using column ${getColumnLetter(eventIdColumnIndex)} (index ${eventIdColumnIndex}) for event IDs`);
        
        // SCAN PHASE: Check ALL rows with event IDs for updates
        console.log("\n----- CHECKING ALL ROWS FOR UPDATES -----");
        let rowsWithEventIds = 0;
        let rowsCheckedForUpdate = 0;
        let rowsUpdated = 0;
        
        // Process rows in smaller batches to prevent memory issues
        const BATCH_SIZE = 10;
        let currentBatch = [];
        
        for (let i = 2; i < allRows.length; i++) {  // Start from row 2 (index 1) to skip header
          const row = allRows[i];

          try {
            // Skip empty rows
            if (!row || row.length < 10) {
              skippedRows.push({ row: i, reason: "insufficient data" });
              continue;
            }

            // Skip rows that are outside the scanning range (today-7days to future)
            if (!isWithinScanningRange(row)) {
              console.log(`Row ${i} date is outside scanning range (today-7days to future), skipping update check`);
              continue;
            }

            // Skip rows without event IDs
            if (!row[eventIdColumnIndex]) {
              // Only log this for rows that should have an event ID
              if (row[1] && row[1].match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
                console.log(`Row ${i} has a valid date but no event ID - needs processing`);
              }
              continue;
            }
            
            rowsWithEventIds++;
            
            // Skip invalid rows - must have a valid date
            if (!row[1] || !row[1].match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
              console.log(`Row ${i} has an event ID but no valid date, skipping update check`);
              skippedRows.push({ row: i, reason: "no valid date" });
              continue;
            }
            
            rowsCheckedForUpdate++;
            
            // Add to current batch for processing
            currentBatch.push({ row, rowIndex: i });
            
            // Process batch when it reaches the batch size
            if (currentBatch.length >= BATCH_SIZE) {
              const batchResults = await processBatchUpdates(
                sheetService,
                calendarService,
                config,
                currentBatch,
                eventIdColumnIndex,
                updatedEvents,
                errors,
                sheetsRateLimiter
              );
              
              rowsUpdated += batchResults.updated;
              currentBatch = []; // Clear the batch
            }
          } catch (error) {
            console.error(`Error preparing row ${i} for batch update:`, error);
            errors.push({
              rowIndex: i,
              error: error.message
            });
          }
        }
        
        // Process any remaining rows in the final batch
        if (currentBatch.length > 0) {
          const batchResults = await processBatchUpdates(
            sheetService,
            calendarService,
            config,
            currentBatch,
            eventIdColumnIndex,
            updatedEvents,
            errors,
            sheetsRateLimiter
          );
          
          rowsUpdated += batchResults.updated;
        }
        
        // Log processing results
        await db.collection("processingLogs").add({
          userId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          scanType: "scheduled-full-update-scan",
          updatedEvents,
          skippedRows,
          errors,
          stats: {
            totalRows: allRows.length,
            rowsWithEventIds,
            rowsCheckedForUpdate,
            rowsUpdated,
            errorCount: errors.length
          }
        });
        
        console.log(`\n===== SCAN COMPLETED FOR USER ${userId} =====`);
        console.log(`Found ${rowsWithEventIds} rows with event IDs`);
        console.log(`Checked ${rowsCheckedForUpdate} rows for updates`);
        console.log(`Updated ${rowsUpdated} events`);
        console.log(`Encountered ${errors.length} errors`);
        
      } catch (userError) {
        console.error(`Error processing user ${userId} in scheduled update:`, userError);
        // Continue with next user even if one fails
      }
    }
    
    console.log("Scheduled full update scan completed for all users");
    return null;
  } catch (error) {
    console.error("Error in scheduledScanAllRowsForUpdates:", error);
    throw error;
  }
});

/**
 * Process a batch of updates with rate limiting
 * @param {Object} sheetService - The Google Sheets API service
 * @param {Object} calendarService - The Google Calendar API service
 * @param {Object} config - The user's configuration
 * @param {Array} batch - Array of {row, rowIndex} objects to process
 * @param {number} eventIdColumnIndex - The column index for event IDs
 * @param {Array} updatedEvents - Array to collect updated event info
 * @param {Array} errors - Array to collect errors
 * @param {RateLimiter} rateLimiter - Rate limiter for API calls
 * @returns {Object} Results with count of updated rows
 */
async function processBatchUpdates(
  sheetService,
  calendarService,
  config,
  batch,
  eventIdColumnIndex,
  updatedEvents,
  errors,
  rateLimiter
) {
  console.log(`Processing batch of ${batch.length} rows`);
  let updatedCount = 0;
  const sheetUpdates = [];
  
  // Process each row in the batch
  for (const { row, rowIndex } of batch) {
    try {
      console.log(`\n===== CHECKING ROW ${rowIndex} FOR UPDATES =====`);
      console.log(`Event ID: ${row[eventIdColumnIndex]}`);
      
      // Get the existing event from the calendar
      let existingEvent;
      try {
        const eventResponse = await calendarService.events.get({
          calendarId: config.calendarId,
          eventId: row[eventIdColumnIndex]
        });
        existingEvent = eventResponse.data;
        console.log(`Successfully retrieved event from calendar: ${row[eventIdColumnIndex]}`);
      } catch (getError) {
        console.error(`Error getting event ${row[eventIdColumnIndex]}: ${getError.message}`);
        errors.push({
          rowIndex,
          error: `Failed to get event: ${getError.message}`
        });
        continue; // Skip to next row
      }
      
      // Get technicians from the spreadsheet row
      const sheetTechnicians = getTechnicians(row);
      console.log(`Technicians from spreadsheet (${sheetTechnicians.length}): ${sheetTechnicians.join(', ') || 'None'}`);
      
      // Get technicians from the calendar event
      const calendarTechnicians = extractTechniciansFromDescription(existingEvent.description);
      console.log(`Technicians from calendar (${calendarTechnicians.length}): ${calendarTechnicians.join(', ') || 'None'}`);
      
      // Check if technicians need updating
      const techniciansNeedUpdate = !areTechnicianListsEqual(calendarTechnicians, sheetTechnicians);
      
      // Check for cancellation flag
      const shouldCancel = row[18] === true || row[18] === "true" || row[18] === "TRUE";
      const eventName = `${row[4] || ''} ${row[5] || ''}`.trim(); // Columns E+F for event name
      
      // Create the new description with technicians
      const newDescription = formatDescription(row);
      
      // Prepare the updated event data
      const updatedEventData = {
        summary: shouldCancel ? `Canceled: ${eventName}` : eventName,
        description: newDescription,
        location: row[6] || '',
        start: {
          dateTime: getStartDateTime(row, 1),
          timeZone: config.timezone || "Asia/Jerusalem",
        },
        end: {
          dateTime: getEndDateTime(row, 1),
          timeZone: config.timezone || "Asia/Jerusalem",
        },
        status: shouldCancel ? 'cancelled' : 'confirmed'
      };

  
      
      // Check for any changes
      const changes = [];
      if (existingEvent.summary !== updatedEventData.summary) changes.push('summary');
      if (existingEvent.description !== updatedEventData.description) changes.push('description');
      if (existingEvent.location !== updatedEventData.location) changes.push('location');
      if (existingEvent.start.dateTime !== updatedEventData.start.dateTime) changes.push('start time');
      if (existingEvent.end.dateTime !== updatedEventData.end.dateTime) changes.push('end time');
      if (existingEvent.status !== updatedEventData.status) changes.push('status');
      if (techniciansNeedUpdate) changes.push('technicians');
      
      // Always update calendar events regardless of detected changes
      console.log(`Updating event ${row[eventIdColumnIndex]} for row ${rowIndex}`);
      
      try {
        await calendarService.events.update({
          calendarId: config.calendarId,
          eventId: row[eventIdColumnIndex],
          resource: updatedEventData
        });
        
        console.log(`Event ${row[eventIdColumnIndex]} updated successfully`);
        
        updatedEvents.push({
          rowIndex,
          eventId: row[eventIdColumnIndex],
          summary: updatedEventData.summary,
          changes: changes.length > 0 ? changes : ['forced update'],
          action: 'updated'
        });
        
        updatedCount++;
        
        // If the event is cancelled, update the processed marker in the sheet
        if (shouldCancel && config.processedColumnIndex !== undefined) {
          sheetUpdates.push({
            rowIndex: rowIndex, // Use the actual rowIndex from the loop
            columnIndex: config.processedColumnIndex,
            value: "CANCELLED"
          });
        }
      } catch (updateError) {
        console.error(`Error updating event ${row[eventIdColumnIndex]}: ${updateError.message}`);
        errors.push({
          rowIndex,
          error: `Failed to update event: ${updateError.message}`
        });
      }
    } catch (error) {
      console.error(`Error processing row ${rowIndex} in batch:`, error);
      errors.push({
        rowIndex,
        error: error.message
      });
    }
  }
  
  // Process any sheet updates in a batch using rate limiter
  if (sheetUpdates.length > 0) {
    try {
      console.log(`Performing batch update for ${sheetUpdates.length} sheet cells`);
      
      // Group updates by column to reduce API calls
      const updatesByColumn = {};
      
      for (const update of sheetUpdates) {
        const columnKey = update.columnIndex.toString();
        if (!updatesByColumn[columnKey]) {
          updatesByColumn[columnKey] = [];
        }
        updatesByColumn[columnKey].push(update);
      }
      
      // Process each column's updates as a batch
      for (const [columnIndex, updates] of Object.entries(updatesByColumn)) {
        const columnLetter = getColumnLetter(parseInt(columnIndex));
        const batchData = updates.map(update => ({
          range: `${config.sheetName}!${columnLetter}${getValidSheetRowNum(update.rowIndex)}`,
          values: [[update.value]]
        }));
        
        await rateLimiter.enqueue(async () => {
          return await sheetService.spreadsheets.values.batchUpdate({
            spreadsheetId: config.spreadsheetId,
            resource: {
              valueInputOption: "RAW",
              data: batchData
            }
          });
        });
        
        console.log(`✓ Successfully updated ${updates.length} cells in column ${columnLetter}`);
      }
    } catch (error) {
      console.error(`Error in batch sheet update: ${error.message}`);
    }
  }
  
  return { updated: updatedCount };
}

/**
 * Scheduled function to sync spreadsheet data with calendar events
 * Runs every 15 minutes to check for new events and updates to existing events
 * Scans events from today-7days to the end of the spreadsheet
 */
// 1. Replace the existing update functions in scanSheetsAndUpdateCalendar with this:

exports.scanSheetsAndUpdateCalendar = onSchedule({
  schedule: 'every 15 minutes',
  region: 'us-central1',
  timeZone: 'Asia/Jerusalem'

}, async (_context) => {
  try {
    console.log("Starting scheduled sheet scan");
    
    // Get all user configurations
    const configsSnapshot = await db.collection("configurations").get();
    
    for (const configDoc of configsSnapshot.docs) {
      const config = configDoc.data();
      const userId = configDoc.id;
      
      // Skip disabled configurations
      if (!config.enabled) {
        console.log(`Configuration ${configDoc.id} is disabled, skipping`);
        continue;
      }
      
      try {
        // Setup API clients
        console.log("Initializing service account auth");
        
        const jwtClient = new google.auth.JWT(
          serviceAccount.client_email,
          null,
          serviceAccount.private_key,
          [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/calendar'
          ]
        );
        
        // Authenticate request
        await jwtClient.authorize();
        console.log("Service account authenticated successfully");
        
        // Create API clients
        const sheetService = google.sheets({version: 'v4', auth: jwtClient});
        const calendarService = google.calendar({version: 'v3', auth: jwtClient});
        
        // Read from Google Sheet
        console.log(`Reading sheet ${config.sheetName} from spreadsheet ${config.spreadsheetId}`);
        const dataRange = config.dataRange || "A1:AZ1000"; // Default range if not specified
        const sheetResponse = await sheetService.spreadsheets.values.get({
          spreadsheetId: config.spreadsheetId,
          range: `${config.sheetName}!${dataRange}`,
        });
        
        const allRows = sheetResponse.data.values || [];
        console.log(`Found ${allRows.length} total rows in sheet`);
        
        // Initialize tracking variables
        let lastProcessedRow = initializeLastProcessedRow(config);
        const processedEvents = [];
        const updatedEvents = [];
        const errors = [];
        
        // FIRST PHASE: Process new unprocessed rows
        console.log(`Processing new rows starting from index ${lastProcessedRow}`);
        
        for (let i = lastProcessedRow; i < allRows.length; i++) {
          const row = allRows[i];

          try {
            // Skip invalid rows
            if (!isValidRow(row, i)) {
              continue;
            }

            // Skip rows that are outside the scanning range (today-7days to future)
            if (!isWithinScanningRange(row)) {
              console.log(`Row ${i} date is outside scanning range (today-7days to future), skipping`);
              continue;
            }

            // Skip if already processed - will check for updates later
            if (isAlreadyProcessed(row, config)) {
              console.log(`Row ${i} already processed, will check for updates later`);
              continue;
            }

            // Skip excluded event types (for new entries only)
            if (isExcludedEventType(row)) {
              console.log(`Skipping row ${i}: Event type "${row[3]}" is excluded`);
              continue;
            }
            
            // Process this row (create a new event)
            console.log(`Creating new event for row ${i}`);
            
            // Format event data
            const eventData = {
              summary: `${row[4] || ''} ${row[5] || ''}`.trim(), // Columns E+F for event name
              description: formatDescription(row),
              location: row[6] || '', // Column G for location
              start: {
                dateTime: getStartDateTime(row, 1), // Date in column B (index 1)
                timeZone: config.timezone || "Asia/Jerusalem",
              },
              end: {
                dateTime: getEndDateTime(row, 1), // Date in column B (index 1)
                timeZone: config.timezone || "Asia/Jerusalem",
              }
            };
            
            // Check for cancellation flag
            const shouldCancel = row[18] === true || row[18] === "true" || row[18] === "TRUE";
            if (shouldCancel) {
              eventData.status = 'cancelled';
            }
            
            // Add event to calendar
            const calendarResponse = await calendarService.events.insert({
              calendarId: config.calendarId,
              resource: eventData,
            });
            
            console.log(`Created calendar event: ${calendarResponse.data.id}`);
            // After creating the calendar event:
        

        
        // Add detailed logging:
        console.log(`EVENT ID DEBUGGING: Need to save event ID ${calendarResponse.data.id} to spreadsheet`);

        // Explicitly set the event ID column to AL (index 37) and store the ID
        try {
          const eventIdColumnIndex = 37; // Column AL
          const sheetRowNum = i + 2; // Use i directly (the loop variable) + 1 for 1-based indexing
          const columnLetter = getColumnLetter(eventIdColumnIndex);
          
          console.log(`Storing event ID in column ${columnLetter} (index ${eventIdColumnIndex}) for row ${sheetRowNum}`);
          
          // Direct API call to update the cell
          await sheetService.spreadsheets.values.update({
            spreadsheetId: config.spreadsheetId,
            range: `${config.sheetName}!${columnLetter}${sheetRowNum}`,
            valueInputOption: "RAW",
            resource: {
              values: [[calendarResponse.data.id]]
            },
          });
          
          console.log(`✓ Successfully stored event ID in spreadsheet`);
        } catch (error) {
          console.error(`❌ Failed to store event ID in spreadsheet: ${error.message}`);
        }
            
            // Mark as processed in the spreadsheet
            if (config.updateProcessedStatus && config.processedColumnIndex !== undefined) {
              await markRowAsProcessed(
                sheetService,
                config,
                i,  // Pass the row index
                calendarResponse.data.id,
                shouldCancel
              );
              
              // Store the event ID
              if (config.eventIdColumnIndex !== undefined) {
                await sheetService.spreadsheets.values.update({
                  spreadsheetId: config.spreadsheetId,
                  range: `${config.sheetName}!${getColumnLetter(config.eventIdColumnIndex)}${i + 1}`,
                  valueInputOption: "RAW",
                  resource: {
                    values: [[calendarResponse.data.id]]
                  },
                });
              }
            }
            
            processedEvents.push({
              rowIndex: i,
              eventId: calendarResponse.data.id,
              summary: eventData.summary,
              action: 'created'
            });
            
            // Update lastProcessedRow if this is the highest index processed
            if (i >= lastProcessedRow) {
              lastProcessedRow = i + 1;
            }
            
          } catch (error) {
            console.error(`Error processing new row ${i}:`, error);
            errors.push({
              rowIndex: i,
              error: error.message
            });
          }
        }
        
        // SECOND PHASE: Check for updates to all rows with event IDs
        console.log("\n----- CHECKING ALL ROWS FOR UPDATES -----");
        
        for (let i = 2; i < allRows.length; i++) {  // Start from row 2 (index 1) to skip header
          const row = allRows[i];
          
          try {
            // Skip rows without event IDs
            if (!config.eventIdColumnIndex || !row[config.eventIdColumnIndex]) {
              continue;
            }
            
            // Skip invalid rows
            if (!isValidRow(row, i)) {
              continue;
            }
            
            // Check and update this event using our enhanced function
            await checkAndUpdateEventEnhanced(
              sheetService,
              calendarService, 
              config,
              row,
              i,
              updatedEvents
            );
            
          } catch (error) {
            console.error(`Error checking for updates to row ${i}:`, error);
            errors.push({
              rowIndex: i,
              error: error.message
            });
          }
        }
        
        // Update the lastProcessedRow in the configuration
        await db.collection("configurations").doc(userId).update({
          lastProcessedRow: lastProcessedRow,
          lastScanTime: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Log processing results
        await db.collection("processingLogs").add({
          userId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          processedEvents,
          updatedEvents,
          errors,
          rowsScanned: allRows.length
        });
        
        console.log(`Completed processing for user ${userId}:`);
        console.log(`  Processed ${processedEvents.length} new events`);
        console.log(`  Updated ${updatedEvents.length} existing events`);
        console.log(`  Encountered ${errors.length} errors`);
        
      } catch (userError) {
        console.error(`Error processing configuration for user ${userId}:`, userError);
        // Continue with next user even if one fails
      }
    }
    
    console.log("Sheet scan and update completed");
    return null;
  } catch (error) {
    console.error("Error in scanSheetsAndUpdateCalendar:", error);
    throw error;
  }
});

/**
 * Read data from the Google Sheet and parse into structured event data
 * @param {Object} sheetService - The Google Sheets API service
 * @param {Object} config - The user's configuration
 * @returns {Object} Structured row data from the sheet
 */
async function readAndStructureSpreadsheetData(sheetService, config) {
  console.log(`Reading sheet ${config.sheetName} from spreadsheet ${config.spreadsheetId}`);
  const dataRange = config.dataRange || "A2:AZ1000"; // Default range if not specified
  
  const sheetResponse = await sheetService.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!${dataRange}`,
  });
  
  const rawRows = sheetResponse.data.values || [];
  console.log(`Found ${rawRows.length} total rows in sheet`);
  
  // Process the raw rows into a structured format
  const structuredRows = [];
  
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    
    // Skip empty rows
    if (!row || row.length === 0) {
      console.log(`Skipping empty row at index ${i+2}`);
      continue;
    }
    
    // Basic validation for date column
    if (!row[1] || !row[1].match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
      console.log(`Row ${i+2} has no valid date in column B (format DD/MM/YY), skipping`);
      continue;
    }
    
    // Get event type from column D (index 3)
   // In functions that handle processing
    const eventType = row[3] || '';
    const isExcludedType = ["הצעת מחיר", "השכרות", "אופציה", "הפקה"].includes(eventType);

   if (isExcludedType) {
  console.log(`Skipping row ${rowIndex} with excluded event type: ${eventType}`);
  
  // Update the lastProcessedRow in the configuration
  await db.collection("configurations").doc(userId).update({
    lastProcessedRow: lastProcessedRow + 1,
    lastScanTime: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Create a log entry
  await db.collection("processingLogs").add({
    userId,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    manualScan: true,
    message: `Row skipped: Event type "${eventType}" is excluded`,
    rowIndex: lastProcessedRow
  });
  
  return {
    success: true,
    message: `Row skipped: Event type "${eventType}" is excluded`,
    rowIndex: lastProcessedRow,
    advancedToNextRow: true
  };
}
    
    // Extract technicians from columns U-AA (indices 20-26)
    const technicians = [];
    for (let j = 20; j <= Math.min(26, row.length - 1); j++) {
      if (row[j] && row[j].trim()) {
        technicians.push(row[j].trim());
      }
    }
    
    // Create a structured representation of the row
    const structuredRow = {
      rawIndex: i + 2,  // 0-based index + 2 (to account for sheet header)
      rawData: row,
      date: row[1],
      day: row[2] || '',
      eventType: eventType,
      eventName: `${row[4] || ''} ${row[5] || ''}`.trim(),
      location: row[6] || '',
      fee: row[7] || '',
      notes: row[8] || '',
      startTime: row[9] || '17:00',
      endTime: row[10] || '20:00',
      manager: row[11] || '',
      shouldCancel: row[18] === true || row[18] === "true" || row[18] === "TRUE",
      technicians: technicians,
      isProcessed: row[config.processedColumnIndex] === config.processedMarker,
      eventId: row[config.eventIdColumnIndex] || null,
      isExcludedType: isExcluded
    };
    
    structuredRows.push(structuredRow);
    
    // Additional logging for debugging
    console.log(`Structured row ${structuredRow.rawIndex}:`);
    console.log(`  Date: ${structuredRow.date}`);
    console.log(`  Event Type: ${structuredRow.eventType}`);
    console.log(`  Event Name: ${structuredRow.eventName}`);
    console.log(`  Technicians: ${structuredRow.technicians.join(', ') || 'None'}`);
    console.log(`  Is Excluded: ${structuredRow.isExcludedType}`);
    console.log(`  Is Processed: ${structuredRow.isProcessed}`);
    console.log(`  Event ID: ${structuredRow.eventId || 'None'}`);
  }
  
  return {
    structuredRows,
    rawRows
  };
}

/**
 * Setup API clients for Sheets and Calendar
 * @returns {Object} Object containing configured API clients
 */
async function setupApiClients() {
  console.log("Initializing service account auth");
  
  const jwtClient = new google.auth.JWT(
    serviceAccount.client_email,
    null,
    serviceAccount.private_key,
    [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar'
    ]
  );
  
  // Authenticate request
  await jwtClient.authorize();
  console.log("Service account authenticated successfully");
  
  // Create API clients
  const sheetService = google.sheets({version: 'v4', auth: jwtClient});
  const calendarService = google.calendar({version: 'v3', auth: jwtClient});
  
  return { sheetService, calendarService };
}

/**
 * Process new rows that haven't been processed yet
 * @param {Object} sheetService - The Google Sheets API service
 * @param {Object} calendarService - The Google Calendar API service
 * @param {Object} config - The user's configuration
 * @param {Array} allRows - All rows from the spreadsheet
 * @param {number} lastProcessedRow - The last processed row index
 * @param {Array} processedEvents - Array to collect processed event info
 * @param {Array} errors - Array to collect errors
 * @returns {number} The new lastProcessedRow value
 */
/**
 * Process multiple rows in a batch to avoid API quota limits
 * @param {Object} sheetService - The Google Sheets API service
 * @param {Object} config - The user's configuration
 * @param {Array} updates - Array of updates [{rowIndex, eventId, isCancelled}]
 */
async function batchUpdateRows(sheetService, config, updates) {
  if (!updates || updates.length === 0) return;
  
  console.log(`Performing batch update for ${updates.length} rows`);
  
  try {
    // The processedColumnIndex from config or default to column AK (index 36)
    const processedColumnIndex = config.processedColumnIndex !== undefined ? 
                                config.processedColumnIndex : 36;
    
    // Always use column AL (index 37) for event IDs
    const eventIdColumnIndex = 37; // Hardcoded to AL
    
    // Prepare batch requests for processed status
    if (config.updateProcessedStatus !== false) {
      const processedUpdates = updates.map(update => {
        const sheetRowNum = getValidSheetRowNum(rowIndex);
        const value = update.isCancelled ? "CANCELLED" : (config.processedMarker || "PROCESSED");
        
        return {
          range: `${config.sheetName}!${getColumnLetter(processedColumnIndex)}${sheetRowNum}`,
          values: [[value]]
        };
      });
      
      // Execute batch update for processed status
      if (processedUpdates.length > 0) {
        await sheetService.spreadsheets.values.batchUpdate({
          spreadsheetId: config.spreadsheetId,
          resource: {
            valueInputOption: "RAW",
            data: processedUpdates
          }
        });
        console.log(`✓ Successfully updated processed status for ${processedUpdates.length} rows`);
      }
    }
    
    // Prepare batch requests for event IDs
    const eventIdUpdates = updates.map(update => {
      const sheetRowNum = getValidSheetRowNum(rowIndex);
      
      return {
        range: `${config.sheetName}!${getColumnLetter(eventIdColumnIndex)}${sheetRowNum}`,
        values: [[update.eventId]]
      };
    });
    
    // Execute batch update for event IDs
    if (eventIdUpdates.length > 0) {
      await sheetService.spreadsheets.values.batchUpdate({
        spreadsheetId: config.spreadsheetId,
        resource: {
          valueInputOption: "RAW",
          data: eventIdUpdates
        }
      });
      console.log(`✓ Successfully stored event IDs for ${eventIdUpdates.length} rows`);
    }
  } catch (error) {
    console.error(`❌ Error in batch update: ${error.message}`);
    console.error(error);
  }
}

/**
 * Process a single new row
 * @param {Object} sheetService - The Google Sheets API service
 * @param {Object} calendarService - The Google Calendar API service
 * @param {Object} config - The user's configuration
 * @param {Array} row - The row data
 * @param {number} rowIndex - The row index
 * @param {Array} processedEvents - Array to collect processed event info
 */
async function processNewRow(
  sheetService, 
  calendarService, 
  config, 
  row, 
  rowIndex, 
  processedEvents
) {
  // Format the technician list
  const techniciansList = getTechnicians(row);
  console.log(`Row ${rowIndex}: ${techniciansList.length} technicians assigned`);
  
  // Prepare event data
  const event = {
    summary: `${row[4] || ''} ${row[5] || ''}`.trim(), // Columns E+F for event name
    description: formatDescription(row),
    location: row[6] || '', // Column G for location
    start: {
      dateTime: getStartDateTime(row, 1), // Date in column B (index 1)
      timeZone: config.timezone || "Asia/Jerusalem",
    },
    end: {
      dateTime: getEndDateTime(row, 1), // Date in column B (index 1)
      timeZone: config.timezone || "Asia/Jerusalem",
    },
  };
  
  // Check for cancellation flag (column S, index 18)
  const shouldCancel = row[18] === true || row[18] === "true" || row[18] === "TRUE";
  
  if (shouldCancel) {
    await handleCancelledEvent(
      sheetService, 
      calendarService, 
      config, 
      row, 
      rowIndex, 
      event, 
      processedEvents
    );
  } else {
    // Add new event to calendar
    const calendarResponse = await calendarService.events.insert({
      calendarId: config.calendarId,
      resource: event,
    });
    
    console.log(`Created calendar event: ${calendarResponse.data.htmlLink}`);
    
    // Mark as processed in the spreadsheet
    await markRowAsProcessed(
      sheetService, 
      config, 
      rowIndex, 
      calendarResponse.data.id, 
      false
    );
    
    processedEvents.push({
      rowIndex,
      eventId: calendarResponse.data.id,
      summary: event.summary,
      action: 'created'
    });
  }
}

/**
 * Handle a cancelled event (either create cancelled or update existing to cancelled)
 * @param {Object} sheetService - The Google Sheets API service
 * @param {Object} calendarService - The Google Calendar API service
 * @param {Object} config - The user's configuration
 * @param {Array} row - The row data
 * @param {number} rowIndex - The row index
 * @param {Object} event - The event data
 * @param {Array} processedEvents - Array to collect processed event info
 */
async function handleCancelledEvent(
  sheetService, 
  calendarService, 
  config, 
  row, 
  rowIndex, 
  event, 
  processedEvents
) {
  console.log(`Row ${rowIndex}: Event marked for cancellation`);
  
  // If there's an existing event ID stored in the row, update its status to cancelled
  if (config.eventIdColumnIndex && row[config.eventIdColumnIndex]) {
    try {
      // First, get the current event
      const eventResponse = await calendarService.events.get({
        calendarId: config.calendarId,
        eventId: row[config.eventIdColumnIndex]
      });
      
      const existingEvent = eventResponse.data;
      
      // Update the event status to cancelled and add "Canceled:" to the summary
      existingEvent.status = 'cancelled';
      
      // Only add "Canceled:" prefix if it's not already there
      if (!existingEvent.summary.startsWith('Canceled:')) {
        existingEvent.summary = `Canceled: ${existingEvent.summary}`;
      }
      
      // Update the event in the calendar
      await calendarService.events.update({
        calendarId: config.calendarId,
        eventId: row[config.eventIdColumnIndex],
        resource: existingEvent
      });
      
      console.log(`Marked event as cancelled in calendar: ${row[config.eventIdColumnIndex]}`);
      
      // Mark as cancelled in the spreadsheet
      await markRowAsProcessed(
        sheetService, 
        config, 
        rowIndex, 
        row[config.eventIdColumnIndex], 
        true
      );
      
      processedEvents.push({
        rowIndex,
        eventId: row[config.eventIdColumnIndex],
        summary: existingEvent.summary,
        status: 'cancelled'
      });
    } catch (updateError) {
      console.error(`Error updating event status: ${updateError}`);
      throw new Error(`Failed to cancel event: ${updateError.message}`);
    }
  } else {
    // No existing event ID found - create a new cancelled event
    console.log(`No existing event ID found. Creating new cancelled event.`);
    
    // Set the event status to cancelled and add "Canceled:" to the summary
    event.status = 'cancelled';
    
    // Only add "Canceled:" prefix if it's not already there
    if (!event.summary.startsWith('Canceled:')) {
      event.summary = `Canceled: ${event.summary}`;
    }
    
    // Add event to calendar
    const calendarResponse = await calendarService.events.insert({
      calendarId: config.calendarId,
      resource: event,
    });
    
    console.log(`Created cancelled calendar event: ${calendarResponse.data.htmlLink}`);
    
    // Mark as cancelled in the spreadsheet
    await markRowAsProcessed(
      sheetService, 
      config, 
      rowIndex, 
      calendarResponse.data.id, 
      true
    );
    
    processedEvents.push({
      rowIndex,
      eventId: calendarResponse.data.id,
      summary: event.summary,
      status: 'cancelled'
    });
  }
}



/**
 * Handle cancellation of an existing event
 * @param {Object} sheetService - The Google Sheets API service
 * @param {Object} calendarService - The Google Calendar API service
 * @param {Object} config - The user's configuration
 * @param {Object} existingEvent - The existing event data
 * @param {number} rowIndex - The row index
 * @param {string} eventId - The event ID
 * @param {Array} updatedEvents - Array to collect updated event info
 */
async function handleExistingEventCancellation(
  sheetService,
  calendarService,
  config,
  existingEvent,
  rowIndex,
  eventId,
  updatedEvents
) {
  console.log(`Row ${rowIndex}: Marking existing event as cancelled`);
  existingEvent.status = 'cancelled';
  
  // Only add "Canceled:" prefix if it's not already there
  if (!existingEvent.summary.startsWith('Canceled:')) {
    existingEvent.summary = `Canceled: ${existingEvent.summary}`;
  }
  
  await calendarService.events.update({
    calendarId: config.calendarId,
    eventId: eventId,
    resource: existingEvent
  });
  
  // Mark as cancelled in the spreadsheet
  if (config.updateProcessedStatus && config.processedColumnIndex !== undefined) {
    const sheetRowNum = getValidSheetRowNum(rowIndex);
    console.log(`Marking cancellation in sheet row ${sheetRowNum}`);
    
    await sheetService.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${config.sheetName}!${getColumnLetter(config.processedColumnIndex)}${sheetRowNum}`,
      valueInputOption: "RAW",
      resource: {
        values: [["CANCELLED"]]
      },
    });
    console.log(`Marked row ${sheetRowNum} as CANCELLED in column ${getColumnLetter(config.processedColumnIndex)}`);
  }
  
  updatedEvents.push({
    rowIndex,
    eventId,
    summary: existingEvent.summary,
    action: 'cancelled'
  });
}

/**
 * Detect changes between existing event and new data
 * @param {Object} existingEvent - The existing event data
 * @param {Object} updatedEventData - The updated event data
 * @param {Array} currentTechnicians - Current technicians in the event
 * @param {Array} techniciansList - New technicians from the row
 * @param {Array} row - The row data
 * @param {number} rowIndex - The row index
 * @returns {Array} Array of detected changes
 */
function detectChanges(
  existingEvent,
  updatedEventData,
  currentTechnicians,
  techniciansList,
  row,
  rowIndex
) {
  const changes = [];
  
  if (existingEvent.summary !== updatedEventData.summary) changes.push('summary');
  if (existingEvent.location !== updatedEventData.location) changes.push('location');
  if (existingEvent.start.dateTime !== updatedEventData.start.dateTime) changes.push('start time');
  if (existingEvent.end.dateTime !== updatedEventData.end.dateTime) changes.push('end time');
  if (existingEvent.status !== updatedEventData.status) changes.push('status');
  
  // Special check for technicians - more detailed logging
  // Always log technician data for debugging
  console.log(`Row ${rowIndex} - Technician data check:`);
  console.log(`Current techs in calendar: ${JSON.stringify(currentTechnicians)}`);
  console.log(`New techs from sheet: ${JSON.stringify(techniciansList)}`);
  
  // First check if the description has changed at all
  const descriptionChanged = existingEvent.description !== updatedEventData.description;
  if (descriptionChanged) {
    console.log(`Row ${rowIndex} - Description changed`);
  }
  
  // Then check if the technician lists are different (comparing sets)
  const techListsEqual = areTechnicianListsEqual(currentTechnicians, techniciansList);
  if (!techListsEqual) {
    console.log(`Row ${rowIndex} - Technician lists are different`);
  }
  
  // Log the actual cells for all technician columns U-AA (indices 20-26)
  console.log(`Row ${rowIndex} - All technician cells U-AA:`, 
    row.slice(20, 27).map((cell, idx) => {
      const colLetter = String.fromCharCode(85 + idx); // U is 85 in ASCII
      return `${colLetter}: ${cell || '(empty)'}`;
    }).join(', '));
  
  const techsChanged = descriptionChanged || !techListsEqual;
  
  if (techsChanged) {
    changes.push('technicians');
    console.log(`Technicians changed in row ${rowIndex} - updating calendar event`);
  }
  
  // If still no changes detected, force a deep comparison on technician data
  if (changes.length === 0) {
    console.log(`No standard changes detected for row ${rowIndex}, performing deep technician comparison`);
    
    // Get the raw technician data from both sources
    const rowTechs = row.slice(20, 27).map(cell => cell?.trim() || '');
    const calendarTechs = currentTechnicians.map(tech => tech?.trim() || '');
    
    // Log the raw data for comparison
    console.log(`Row techs (U-AA): ${JSON.stringify(rowTechs)}`);
    console.log(`Calendar techs: ${JSON.stringify(calendarTechs)}`);
    
    // Force update if there's any difference in the raw technician data
    const forceUpdate = !rowTechs.every((tech, idx) => {
      const hasData = tech !== '';
      const matchesCalendar = idx < calendarTechs.length && 
                             tech === calendarTechs[idx];
      
      if (hasData && !matchesCalendar) {
        console.log(`Force update: column ${String.fromCharCode(85 + idx)} has changed`);
        return false;
      }
      return true;
    });
    
    if (forceUpdate) {
      changes.push('technician data (forced update)');
      console.log(`Forcing update due to technician data differences`);
    }
  }
  
  return changes;
}

/**
 * Mark a row as processed in the spreadsheet
 * @param {Object} sheetService - The Google Sheets API service
 * @param {Object} config - The user's configuration
 * @param {number} rowIndex - The row index
 * @param {string} eventId - The event ID
 * @param {boolean} isCancelled - Whether the event is cancelled
 */

// Modify markRowAsProcessed to use rate limiting
async function markRowAsProcessed(sheetService, config, rowIndex, eventId, isCancelled) {
  try {
    // Create these values outside API calls
    const processedColumnIndex = config.processedColumnIndex !== undefined ? 
                               config.processedColumnIndex : 36;
    const eventIdColumnIndex = config.eventIdColumnIndex !== undefined ? 
                             config.eventIdColumnIndex : 37;
    const processedSheetRowNum = rowIndex + 2; 
    const eventIdSheetRowNum = getValidSheetRowNum(rowIndex);
    const processedValue = isCancelled ? "CANCELLED" : (config.processedMarker || "PROCESSED");
    
    console.log(`=== CRITICAL DEBUG FOR AK COLUMN (PROCESSED STATUS) ===`);
    console.log(`Raw rowIndex value: ${rowIndex}`);
    console.log(`FIXING PROCESSED COLUMN: Using sheet row ${processedSheetRowNum} (rowIndex + 2) for column AK`);
    console.log(`For event ID column: Using sheet row ${eventIdSheetRowNum}`);
    console.log(`=== END CRITICAL DEBUG ===`);
    
    // Use a delay between API calls to prevent quota issues
    if (config.updateProcessedStatus !== false) {
      console.log(`WRITING TO AK: Marking row ${processedSheetRowNum} as "${processedValue}" in column ${getColumnLetter(processedColumnIndex)}`);
      
      // First API call with rate limiting
      await new Promise(resolve => setTimeout(resolve, 500)); // Add 500ms delay
      
      await sheetService.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range: `${config.sheetName}!${getColumnLetter(processedColumnIndex)}${processedSheetRowNum}`,
        valueInputOption: "RAW",
        resource: {
          values: [[processedValue]]
        },
      });
      console.log(`✓ SUCCESSFULLY WROTE TO AK${processedSheetRowNum}`);
    }
    
    // Add delay before second API call
    await new Promise(resolve => setTimeout(resolve, 1000)); // Add 1s delay
    
    // Store the event ID with delay
    console.log(`Storing event ID ${eventId} in row ${eventIdSheetRowNum}, column ${getColumnLetter(eventIdColumnIndex)}`);
    
    await sheetService.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${config.sheetName}!${getColumnLetter(eventIdColumnIndex)}${eventIdSheetRowNum}`,
      valueInputOption: "RAW",
      resource: {
        values: [[eventId]]
      },
    });
  } catch (error) {
    console.error(`Error in markRowAsProcessed for row ${rowIndex}: ${error.message}`);
    throw error;
  }
}



exports.deleteEventsInMonth = functions
  .runWith({
    timeoutSeconds: 540, // Maximum timeout (9 minutes)
    memory: '1GB'
  })
  .https.onCall(async (data, context) => {
    // Authentication checks
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required"
      );
    }
    
    // Check domain
    const email = context.auth.token.email || "";
    if (!email.endsWith("@hakolsound.co.il")) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only hakolsound.co.il organization members allowed"
      );
    }
    
    const userId = context.auth.uid;
    
    try {
      console.log(`Starting deletion of events for month ${data.month}/${data.year} for user ${userId}`);
      
      // Validate parameters
      const year = data.year || new Date().getFullYear();
      const month = data.month || new Date().getMonth() + 1; // 1-12
      const includeDuplicates = !!data.includeDuplicates;
      
      if (month < 1 || month > 12) {
        throw new functions.https.HttpsError("invalid-argument", "Month must be between 1 and 12");
      }
      
      // Get user configuration
      const configDoc = await db.collection("configurations").doc(userId).get();
      
      if (!configDoc.exists) {
        throw new functions.https.HttpsError("not-found", "Configuration not found");
      }
      
      const config = configDoc.data();
      const calendarId = config.calendarId;

      if (!calendarId) {
        throw new functions.https.HttpsError("failed-precondition", "Calendar ID not configured");
      }

      console.log(`Using calendar ID: ${calendarId}`);

      // Setup API client
      console.log("Initializing service account auth");
      const jwtClient = new google.auth.JWT(
        serviceAccount.client_email,
        null,
        serviceAccount.private_key,
        ['https://www.googleapis.com/auth/calendar']
      );
      
      // Authenticate request
      await jwtClient.authorize();
      console.log("Service account authenticated successfully");
      
      // Create API client
      const calendarService = google.calendar({version: 'v3', auth: jwtClient});
      
      // Create date range for the specific month
      // Use the first day of the month at 00:00:00 and last day at 23:59:59
      // Important: Don't convert to ISO string yet - keep as Date objects
      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      // Format for Google Calendar API - it expects ISO strings
      const timeMin = startDate.toISOString();
      const timeMax = endDate.toISOString();

      console.log(`Searching for events from ${timeMin} to ${timeMax}`);

      // Get Firebase tracking data for this user to find events to delete
      console.log('Loading event tracking data from Firebase...');
      const trackingData = await getAllEventTracking(userId);
      console.log(`Loaded tracking for ${Object.keys(trackingData).length} events`);

      // Filter tracking data to only include events in the target month
      const eventsToDelete = [];
      for (const [rowIndex, tracking] of Object.entries(trackingData)) {
        if (tracking.eventId && tracking.date) {
          // Parse the date (format: YYYY-MM-DD)
          const eventDate = new Date(tracking.date);
          const eventMonth = eventDate.getMonth() + 1; // 0-based to 1-based
          const eventYear = eventDate.getFullYear();

          if (eventMonth === month && eventYear === year) {
            eventsToDelete.push({
              eventId: tracking.eventId,
              rowIndex: parseInt(rowIndex),
              title: tracking.title || 'Unknown'
            });
          }
        }
      }

      console.log(`Found ${eventsToDelete.length} tracked events to delete for ${month}/${year}`);

      // Delete each tracked event from the calendar
      let eventsDeleted = 0;
      const deletedRowIndices = [];
      const trackedEventIds = new Set();

      for (const eventInfo of eventsToDelete) {
        trackedEventIds.add(eventInfo.eventId);
        try {
          await calendarService.events.delete({
            calendarId: calendarId,
            eventId: eventInfo.eventId
          });
          eventsDeleted++;
          deletedRowIndices.push(eventInfo.rowIndex);
          console.log(`Deleted tracked event: ${eventInfo.eventId} - ${eventInfo.title}`);
        } catch (deleteError) {
          // Event might have been already deleted or not found
          console.error(`Error deleting event ${eventInfo.eventId}: ${deleteError.message}`);

          // Still remove from tracking if it's a 404 (not found) error
          if (deleteError.code === 404 || deleteError.message.includes('Not Found')) {
            deletedRowIndices.push(eventInfo.rowIndex);
          }
        }
      }

      // Also query the calendar directly for any untracked events in this month
      // This handles events created before Firebase tracking was implemented or by manualScan
      console.log(`Searching calendar directly for untracked events in ${month}/${year}...`);
      console.log(`Query params: calendarId=${calendarId}, timeMin=${timeMin}, timeMax=${timeMax}`);
      let pageToken = null;
      let untrackedDeleted = 0;

      do {
        try {
          const response = await calendarService.events.list({
            calendarId: calendarId,
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: true,
            pageToken: pageToken,
            maxResults: 100
          });

          const events = response.data.items || [];
          pageToken = response.data.nextPageToken;

          console.log(`Found ${events.length} calendar events in batch (page token: ${pageToken || 'none'})`);
          if (events.length > 0) {
            console.log(`Sample event: ${JSON.stringify(events[0])}`);
          }

          // Delete events that aren't in our tracking
          for (const event of events) {
            if (!trackedEventIds.has(event.id)) {
              try {
                await calendarService.events.delete({
                  calendarId: calendarId,
                  eventId: event.id
                });
                untrackedDeleted++;
                eventsDeleted++;
                console.log(`Deleted untracked event: ${event.id} - ${event.summary || 'Unknown'}`);
              } catch (deleteError) {
                console.error(`Error deleting untracked event ${event.id}: ${deleteError.message}`);
              }
            }
          }
        } catch (listError) {
          console.error(`Error listing calendar events: ${listError.message}`);
          console.error(`Error details: ${JSON.stringify(listError)}`);
          break; // Exit loop on error
        }
      } while (pageToken);

      console.log(`Deleted ${untrackedDeleted} untracked events from calendar`);

      // Remove deleted events from Firebase tracking
      if (deletedRowIndices.length > 0) {
        console.log(`Removing ${deletedRowIndices.length} events from Firebase tracking...`);
        for (const rowIndex of deletedRowIndices) {
          await deleteEventTracking(userId, rowIndex);
        }
      }

      const totalEvents = eventsToDelete.length + untrackedDeleted;

      // Log the deletion
      await db.collection("processingLogs").add({
        userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        operation: "delete-month-events",
        year: year,
        month: month,
        totalEvents: totalEvents,
        eventsDeleted: eventsDeleted
      });
      
      return {
        success: true,
        message: `Successfully deleted ${eventsDeleted} out of ${totalEvents} events from ${month}/${year}`,
        eventsDeleted: eventsDeleted,
        totalEvents: totalEvents
      };
      
    } catch (error) {
      console.error("Error in deleteEventsInMonth:", error);
      throw new functions.https.HttpsError("internal", error.message);
    }
  });

// Reprocess selected rows (re-add events to calendar)
exports.reprocessSelectedRows = functions
  .runWith({
    timeoutSeconds: 300, // 5 minutes
    memory: '512MB'
  })
  .https.onCall(async (data, context) => {
    // Authentication checks
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Authentication required");
    }

    const email = context.auth.token.email || "";
    if (!email.endsWith("@hakolsound.co.il")) {
      throw new functions.https.HttpsError("permission-denied", "Only hakolsound.co.il organization members allowed");
    }

    const userId = context.auth.uid;

    try {
      const { rowIndices } = data; // Array of row indices to reprocess

      if (!rowIndices || !Array.isArray(rowIndices) || rowIndices.length === 0) {
        throw new functions.https.HttpsError("invalid-argument", "rowIndices must be a non-empty array");
      }

      console.log(`Reprocessing ${rowIndices.length} rows for user ${userId}`);

      // Get user configuration
      const configDoc = await db.collection("configurations").doc(userId).get();
      if (!configDoc.exists) {
        throw new functions.https.HttpsError("not-found", "Configuration not found");
      }

      const config = configDoc.data();
      console.log("Config:", { spreadsheetId: config.spreadsheetId, calendarId: config.calendarId });

      // Setup service account
      const jwtClient = new google.auth.JWT(
        serviceAccount.client_email,
        null,
        serviceAccount.private_key,
        ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar']
      );

      await jwtClient.authorize();

      const sheetService = google.sheets({version: 'v4', auth: jwtClient});
      const calendarService = google.calendar({version: 'v3', auth: jwtClient});

      // Get all data from the sheet
      const response = await sheetService.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range: `${config.sheetName}!${config.dataRange}`
      });

      const rows = response.data.values || [];
      let processedCount = 0;
      let skippedCount = 0;
      const errors = [];
      const firebaseUpdates = []; // Collect Firebase tracking updates

      // Fetch coordination sheet hyperlinks for all selected rows
      console.log('Fetching coordination sheet links...');
      const coordinationLinks = await fetchCoordinationSheetLinks(
        sheetService,
        config.spreadsheetId,
        config.sheetName,
        rowIndices
      );

      // Process each selected row
      for (const rowIndex of rowIndices) {
        try {
          // rowIndex is 0-based for the data array, but the sheet is 1-based + 1 for header
          const row = rows[rowIndex];

          if (!row || row.length === 0) {
            console.log(`Skipping empty row at index ${rowIndex}`);
            skippedCount++;
            continue;
          }

          // Parse the event data using the same SHEET_COLUMNS mapping
          const dateValue = row[SHEET_COLUMNS.DATE]; // Column B (index 1)
          if (!dateValue) {
            skippedCount++;
            continue;
          }

          // Parse the date
          let eventDate;
          if (typeof dateValue === 'number') {
            eventDate = excelDateToJSDate(dateValue);
          } else if (typeof dateValue === 'string') {
            eventDate = parseDate(dateValue);
          }

          if (!eventDate || isNaN(eventDate.getTime())) {
            console.log(`Invalid date for row ${rowIndex}: ${dateValue}`);
            skippedCount++;
            continue;
          }

          // Extract event details using SHEET_COLUMNS mapping
          const title = row[SHEET_COLUMNS.TITLE] || '';
          const location = row[SHEET_COLUMNS.LOCATION] || '';
          const startTime = row[SHEET_COLUMNS.START_TIME] || '';
          const endTime = row[SHEET_COLUMNS.END_TIME] || '';
          const shouldCancel = row[18] === true || row[18] === "true" || row[18] === "TRUE";
          const finalTitle = shouldCancel ? `Canceled: ${title}` : title;

          // Create calendar event with formatted description
          const coordinationUrl = coordinationLinks[rowIndex] || null;
          const event = {
            summary: finalTitle,
            location: location,
            description: formatDescription(row, coordinationUrl), // Use formatted description with hyperlink
            start: {},
            end: {}
          };

          // Set start/end times
          if (startTime && typeof startTime === 'string' && startTime.includes(':')) {
            const [startHour, startMin] = startTime.split(':').map(Number);

            // Format datetime in local timezone (don't convert to UTC)
            // Format: YYYY-MM-DDTHH:MM:SS
            const year = eventDate.getFullYear();
            const month = String(eventDate.getMonth() + 1).padStart(2, '0');
            const day = String(eventDate.getDate()).padStart(2, '0');
            const hour = String(startHour).padStart(2, '0');
            const minute = String(startMin).padStart(2, '0');

            event.start.dateTime = `${year}-${month}-${day}T${hour}:${minute}:00`;
            event.start.timeZone = config.timezone || 'Asia/Jerusalem';

            if (endTime && typeof endTime === 'string' && endTime.includes(':')) {
              const [endHour, endMin] = endTime.split(':').map(Number);
              const endHourStr = String(endHour).padStart(2, '0');
              const endMinStr = String(endMin).padStart(2, '0');
              event.end.dateTime = `${year}-${month}-${day}T${endHourStr}:${endMinStr}:00`;
              event.end.timeZone = config.timezone || 'Asia/Jerusalem';
            } else {
              // Default end time: 6 hours after start
              const endHour = startHour + 6;
              const endHourStr = String(endHour).padStart(2, '0');
              event.end.dateTime = `${year}-${month}-${day}T${endHourStr}:${minute}:00`;
              event.end.timeZone = config.timezone || 'Asia/Jerusalem';
            }
          } else {
            // No time specified - use default 17:00-23:00
            const year = eventDate.getFullYear();
            const month = String(eventDate.getMonth() + 1).padStart(2, '0');
            const day = String(eventDate.getDate()).padStart(2, '0');

            event.start.dateTime = `${year}-${month}-${day}T17:00:00`;
            event.start.timeZone = config.timezone || 'Asia/Jerusalem';
            event.end.dateTime = `${year}-${month}-${day}T23:00:00`;
            event.end.timeZone = config.timezone || 'Asia/Jerusalem';
          }

          // Insert the event into calendar
          const calendarResponse = await calendarService.events.insert({
            calendarId: config.calendarId,
            resource: event
          });

          processedCount++;
          const eventId = calendarResponse.data.id;
          console.log(`Processed row ${rowIndex + 2}: ${finalTitle} (Event ID: ${eventId})`);

          // Prepare Firebase tracking data for this row
          const processedValue = shouldCancel ? "CANCELLED" : "PROCESSED";

          // Parse date for tracking
          let dateStr = '';
          if (eventDate) {
            dateStr = eventDate.toISOString().split('T')[0];
          }

          firebaseUpdates.push({
            rowIndex: rowIndex,
            eventId: eventId,
            status: processedValue,
            eventData: {
              title: finalTitle,
              date: dateStr,
              location: location
            }
          });

        } catch (rowError) {
          console.error(`Error processing row ${rowIndex}:`, rowError);
          errors.push({ rowIndex, error: rowError.message });
        }
      }

      // Save all tracking data to Firebase
      if (firebaseUpdates.length > 0) {
        console.log(`Saving ${firebaseUpdates.length} event tracking records to Firebase...`);
        await batchSaveEventTracking(userId, firebaseUpdates);
      }

      // Write event IDs back to the spreadsheet (Column AL - event ID column)
      // This provides a backup identifier in case row indices change
      console.log(`Writing ${firebaseUpdates.length} event IDs to spreadsheet...`);
      for (const update of firebaseUpdates) {
        try {
          const sheetRowNum = update.rowIndex + 2;
          const columnLetter = 'AL'; // Column AL (index 37)

          await sheetService.spreadsheets.values.update({
            spreadsheetId: config.spreadsheetId,
            range: `${config.sheetName}!${columnLetter}${sheetRowNum}`,
            valueInputOption: "RAW",
            resource: {
              values: [[update.eventId]]
            },
          });

          console.log(`✓ Wrote event ID to ${columnLetter}${sheetRowNum}`);

          // Add delay to prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (writeError) {
          console.error(`Error writing event ID to sheet row ${update.rowIndex + 2}:`, writeError.message);
        }
      }

      // Log the operation
      await db.collection("processingLogs").add({
        userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        operation: "reprocess-selected-rows",
        rowCount: rowIndices.length,
        processedCount,
        skippedCount,
        errorCount: errors.length
      });

      return {
        success: true,
        message: `Processed ${processedCount} of ${rowIndices.length} rows`,
        stats: {
          requested: rowIndices.length,
          processed: processedCount,
          skipped: skippedCount,
          errors: errors.length
        },
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.error("Error in reprocessSelectedRows:", error);
      throw new functions.https.HttpsError("internal", error.message);
    }
  });

// Scan entire month - similar to reprocessSelectedRows but for all events in a month
exports.scanMonthEvents = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '1GB'
  })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Authentication required");
    }

    const email = context.auth.token.email || "";
    if (!email.endsWith("@hakolsound.co.il")) {
      throw new functions.https.HttpsError("permission-denied", "Only hakolsound.co.il organization members allowed");
    }

    const userId = context.auth.uid;

    try {
      const { month, year } = data;

      if (!month || !year) {
        throw new functions.https.HttpsError("invalid-argument", "month and year required");
      }

      console.log(`Scanning all events for ${month}/${year} for user ${userId}`);

      // Get user configuration
      const configDoc = await db.collection("configurations").doc(userId).get();
      if (!configDoc.exists) {
        throw new functions.https.HttpsError("not-found", "Configuration not found");
      }

      const config = configDoc.data();

      // Setup service account
      const jwtClient = new google.auth.JWT(
        serviceAccount.client_email,
        null,
        serviceAccount.private_key,
        ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar']
      );

      await jwtClient.authorize();

      const sheetService = google.sheets({version: 'v4', auth: jwtClient});
      const calendarService = google.calendar({version: 'v3', auth: jwtClient});

      // Get all data from the sheet
      const response = await sheetService.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range: `${config.sheetName}!${config.dataRange}`
      });

      const rows = response.data.values || [];

      // Filter rows by month/year
      const rowsToProcess = [];
      const excludedEventTypes = ['הצעת מחיר', 'השכרות', 'הפקה', 'אופציה'];

      rows.forEach((row, rowIndex) => {
        if (!row || row.length <= SHEET_COLUMNS.DATE) return;

        const dateValue = row[SHEET_COLUMNS.DATE];
        if (!dateValue) return;

        // Parse date
        let eventDate;
        if (typeof dateValue === 'number') {
          eventDate = excelDateToJSDate(dateValue);
        } else if (typeof dateValue === 'string') {
          eventDate = parseDate(dateValue);
        }

        if (!eventDate || isNaN(eventDate.getTime())) return;

        // Check if in target month/year
        if (eventDate.getMonth() + 1 === month && eventDate.getFullYear() === year) {
          // Skip excluded types
          const eventType = row[SHEET_COLUMNS.EVENT_TYPE_D] || '';
          if (excludedEventTypes.includes(eventType)) return;

          rowsToProcess.push({ row, rowIndex, eventDate });
        }
      });

      console.log(`Found ${rowsToProcess.length} events to process for ${month}/${year}`);

      // Fetch coordination sheet hyperlinks for all rows to process
      const rowIndicesToFetch = rowsToProcess.map(r => r.rowIndex);
      console.log('Fetching coordination sheet links...');
      const coordinationLinks = await fetchCoordinationSheetLinks(
        sheetService,
        config.spreadsheetId,
        config.sheetName,
        rowIndicesToFetch
      );

      // Process each row
      let processedCount = 0;
      let skippedCount = 0;
      const errors = [];
      const firebaseUpdates = [];

      for (const { row, rowIndex, eventDate } of rowsToProcess) {
        try {
          const title = row[SHEET_COLUMNS.TITLE] || '';
          const location = row[SHEET_COLUMNS.LOCATION] || '';
          const startTime = row[SHEET_COLUMNS.START_TIME] || '';
          const endTime = row[SHEET_COLUMNS.END_TIME] || '';
          const shouldCancel = row[18] === true || row[18] === "true" || row[18] === "TRUE";
          const finalTitle = shouldCancel ? `Canceled: ${title}` : title;

          // Create calendar event with formatted description
          const coordinationUrl = coordinationLinks[rowIndex] || null;
          const event = {
            summary: finalTitle,
            location: location,
            description: formatDescription(row, coordinationUrl), // Use formatted description with hyperlink
            start: {},
            end: {}
          };

          // Set start/end times using same logic as reprocessSelectedRows
          if (startTime && typeof startTime === 'string' && startTime.includes(':')) {
            const [startHour, startMin] = startTime.split(':').map(Number);
            const year = eventDate.getFullYear();
            const month = String(eventDate.getMonth() + 1).padStart(2, '0');
            const day = String(eventDate.getDate()).padStart(2, '0');
            const hour = String(startHour).padStart(2, '0');
            const minute = String(startMin).padStart(2, '0');

            event.start.dateTime = `${year}-${month}-${day}T${hour}:${minute}:00`;
            event.start.timeZone = config.timezone || 'Asia/Jerusalem';

            if (endTime && typeof endTime === 'string' && endTime.includes(':')) {
              const [endHour, endMin] = endTime.split(':').map(Number);
              const endHourStr = String(endHour).padStart(2, '0');
              const endMinStr = String(endMin).padStart(2, '0');
              event.end.dateTime = `${year}-${month}-${day}T${endHourStr}:${endMinStr}:00`;
              event.end.timeZone = config.timezone || 'Asia/Jerusalem';
            } else {
              const endHour = startHour + 6;
              const endHourStr = String(endHour).padStart(2, '0');
              event.end.dateTime = `${year}-${month}-${day}T${endHourStr}:${minute}:00`;
              event.end.timeZone = config.timezone || 'Asia/Jerusalem';
            }
          } else {
            // Default 17:00-23:00
            const year = eventDate.getFullYear();
            const month = String(eventDate.getMonth() + 1).padStart(2, '0');
            const day = String(eventDate.getDate()).padStart(2, '0');

            event.start.dateTime = `${year}-${month}-${day}T17:00:00`;
            event.start.timeZone = config.timezone || 'Asia/Jerusalem';
            event.end.dateTime = `${year}-${month}-${day}T23:00:00`;
            event.end.timeZone = config.timezone || 'Asia/Jerusalem';
          }

          // Insert event
          const calendarResponse = await calendarService.events.insert({
            calendarId: config.calendarId,
            resource: event
          });

          processedCount++;
          const eventId = calendarResponse.data.id;

          // Prepare Firebase tracking
          const processedValue = shouldCancel ? "CANCELLED" : "PROCESSED";
          let dateStr = '';
          if (eventDate) {
            dateStr = eventDate.toISOString().split('T')[0];
          }

          firebaseUpdates.push({
            rowIndex: rowIndex,
            eventId: eventId,
            status: processedValue,
            eventData: {
              title: finalTitle,
              date: dateStr,
              location: location
            }
          });

          console.log(`Processed row ${rowIndex + 2}: ${finalTitle}`);

        } catch (rowError) {
          console.error(`Error processing row ${rowIndex}:`, rowError);
          errors.push({ rowIndex, error: rowError.message });
          skippedCount++;
        }
      }

      // Save to Firebase
      if (firebaseUpdates.length > 0) {
        await batchSaveEventTracking(userId, firebaseUpdates);
      }

      // Write to spreadsheet Column AL
      console.log(`Writing ${firebaseUpdates.length} event IDs to spreadsheet...`);
      for (const update of firebaseUpdates) {
        try {
          const sheetRowNum = update.rowIndex + 2;
          await sheetService.spreadsheets.values.update({
            spreadsheetId: config.spreadsheetId,
            range: `${config.sheetName}!AL${sheetRowNum}`,
            valueInputOption: "RAW",
            resource: { values: [[update.eventId]] },
          });
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (writeError) {
          console.error(`Error writing event ID:`, writeError.message);
        }
      }

      return {
        success: true,
        message: `Scanned ${month}/${year}: ${processedCount} events created`,
        stats: {
          total: rowsToProcess.length,
          processed: processedCount,
          skipped: skippedCount,
          errors: errors.length
        }
      };

    } catch (error) {
      console.error("Error in scanMonthEvents:", error);
      throw new functions.https.HttpsError("internal", error.message);
    }
  });

// Delete selected events from calendar
exports.deleteSelectedEvents = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '512MB'
  })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Authentication required");
    }

    const email = context.auth.token.email || "";
    if (!email.endsWith("@hakolsound.co.il")) {
      throw new functions.https.HttpsError("permission-denied", "Only hakolsound.co.il organization members allowed");
    }

    const userId = context.auth.uid;

    try {
      const { rowIndices } = data;

      if (!rowIndices || !Array.isArray(rowIndices) || rowIndices.length === 0) {
        throw new functions.https.HttpsError("invalid-argument", "rowIndices must be a non-empty array");
      }

      console.log(`Deleting ${rowIndices.length} selected events for user ${userId}`);

      // Get user configuration
      const configDoc = await db.collection("configurations").doc(userId).get();
      if (!configDoc.exists) {
        throw new functions.https.HttpsError("not-found", "Configuration not found");
      }

      const config = configDoc.data();

      // Setup service account
      const jwtClient = new google.auth.JWT(
        serviceAccount.client_email,
        null,
        serviceAccount.private_key,
        ['https://www.googleapis.com/auth/calendar']
      );

      await jwtClient.authorize();
      const calendarService = google.calendar({version: 'v3', auth: jwtClient});

      // Get Firebase tracking for these rows
      const trackingData = await getAllEventTracking(userId);

      let deletedCount = 0;
      const errors = [];
      const deletedRowIndices = [];

      for (const rowIndex of rowIndices) {
        try {
          const tracking = trackingData[rowIndex];

          if (tracking && tracking.eventId) {
            // Delete from calendar
            await calendarService.events.delete({
              calendarId: config.calendarId,
              eventId: tracking.eventId
            });

            deletedCount++;
            deletedRowIndices.push(rowIndex);
            console.log(`Deleted event: ${tracking.eventId} - ${tracking.title}`);
          } else {
            console.log(`No tracking found for row ${rowIndex}`);
          }
        } catch (deleteError) {
          console.error(`Error deleting row ${rowIndex}:`, deleteError.message);

          // Still try to remove from tracking if 404
          if (deleteError.code === 404 || deleteError.message.includes('Not Found')) {
            deletedRowIndices.push(rowIndex);
          }

          errors.push({ rowIndex, error: deleteError.message });
        }
      }

      // Remove from Firebase tracking
      for (const rowIndex of deletedRowIndices) {
        await deleteEventTracking(userId, rowIndex);
      }

      return {
        success: true,
        message: `Deleted ${deletedCount} of ${rowIndices.length} events`,
        stats: {
          requested: rowIndices.length,
          deleted: deletedCount,
          errors: errors.length
        },
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.error("Error in deleteSelectedEvents:", error);
      throw new functions.https.HttpsError("internal", error.message);
    }
  });

  // Helper function to get service account

// Columns mapping (shared across functions)
const SHEET_COLUMNS = {
  DATE: 1,          // Column B: Date (DD/MM/YY)
  DAY: 2,           // Column C: Day of week
  EVENT_TYPE_D: 3,  // Column D: Event Type Detail
  EVENT_TYPE: 4,    // Column E: Event Type
  TITLE: 5,         // Column F: Title
  LOCATION: 6,      // Column G: Location
  NOTES: 8,         // Column I: Notes
  START_TIME: 9,    // Column J: Start Time
  END_TIME: 10,     // Column K: End Time
  MANAGER: 11,      // Column L: Manager
  STATUS: 13,       // Column N: Status
  EQUIPMENT_URL: 13, // Column N: Also contains hyperlink
  TECHNICIANS: {    // Columns T-Z: Technicians
    START: 20,      // Column T (0-based index is 19)
    END: 26         // Column Z (0-based index is 25)
  }
};

  exports.getTimeframeEvents = functions.https.onCall(async (data, context) => {
    // Authentication checks
    if (!context.auth) {
      return {
        success: false,
        error: "Authentication required"
      };
    }
    
    // Check domain
    const email = context.auth.token.email || "";
    if (!email.endsWith("@hakolsound.co.il")) {
      return {
        success: false,
        error: "Only hakolsound.co.il organization members allowed"
      };
    }
    
    const userId = context.auth.uid;
  
    try {
      // Make sure to extract timeframe from data FIRST
      const timeframe = data.timeframe || 'today';
      console.log("Received timeframe:", timeframe);
      
      // Get user configuration
      const configDoc = await db.collection('configurations').doc(userId).get();
      if (!configDoc.exists) {
        // Try to get the shared configuration
        const sharedConfigDoc = await db.collection('configurations').doc('shared').get();
        
        if (!sharedConfigDoc.exists) {
          return {
            success: false,
            error: 'Configuration not found. Please contact the administrator.'
          };
        }
        
        // Use the shared configuration instead
        config = sharedConfigDoc.data();
      } else {
        config = configDoc.data();
      }
      
      // Calculate date range based on timeframe
      const now = new Date();
  
      // Helper to start/end days
      const startOfDay = (date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
      };
  
      const endOfDay = (date) => {
        const d = new Date(date);
        d.setHours(23, 59, 59, 999);
        return d;
      };
  
      // Initialize timeMin and timeMax with default values
      let timeMin = startOfDay(now);
      let timeMax = endOfDay(now);
  
      // Make sure the timeframe is a valid string before using it
      if (timeframe && typeof timeframe === 'string') {
        switch (timeframe) {
          case 'today':
            // Already set to default values
            break;
          case '3days':
            // timeMin already set to startOfDay(now)
            const threeDaysLater = new Date(now);
            threeDaysLater.setDate(now.getDate() + 2);
            timeMax = endOfDay(threeDaysLater);
            break;
          case 'week':
            // Calculate start of week (Sunday)
            const startOfWeek = new Date(now);
            const day = startOfWeek.getDay(); // 0 = Sunday, 1 = Monday, etc.
            startOfWeek.setDate(startOfWeek.getDate() - day);
            
            // Calculate end of week (Saturday)
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            
            timeMin = startOfDay(startOfWeek);
            timeMax = endOfDay(endOfWeek);
            break;
          case 'month':
            // Support custom month/year from request, otherwise use current month
            const targetMonth = (data.month !== undefined && data.month !== null) ? data.month - 1 : now.getMonth(); // month is 1-12, Date uses 0-11
            const targetYear = data.year || now.getFullYear();

            const startOfMonth = new Date(targetYear, targetMonth, 1);
            const endOfMonth = new Date(targetYear, targetMonth + 1, 0);

            timeMin = startOfDay(startOfMonth);
            timeMax = endOfDay(endOfMonth);

            console.log(`Using month ${targetMonth + 1}/${targetYear} for date range`);
            break;
          default:
            // Invalid timeframe, use default (today)
            console.log(`Invalid timeframe: ${timeframe}, using 'today' instead`);
            // timeMin and timeMax already set to today's values
        }
      }
  
      // Verify that both timeMin and timeMax are valid Date objects before calling toISOString()
      if (!(timeMin instanceof Date) || isNaN(timeMin.getTime())) {
        console.error("Invalid timeMin:", timeMin);
        timeMin = startOfDay(now); // Use today as fallback
      }
  
      if (!(timeMax instanceof Date) || isNaN(timeMax.getTime())) {
        console.error("Invalid timeMax:", timeMax);
        timeMax = endOfDay(now); // Use today as fallback
      }
  
      // Now it's safe to call toISOString()
      console.log(`Date range for ${timeframe}:`, {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString()
      });
      
      try {
        // The important part: properly initialize the Google Sheets client
        console.log(`Fetching data from spreadsheet ${config.spreadsheetId}`);
        
        // Make sure serviceAccount is defined
        if (!serviceAccount) {
          console.error("Service account is not defined");
          return {
            success: false,
            error: "Service account configuration missing"
          };
        }
        
        // Create and log the auth client first to verify it's working
        const auth = new google.auth.GoogleAuth({
          credentials: serviceAccount,
          scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
        });
        
        console.log("Auth client created successfully");
        
        // Create sheets client
        const sheets = google.sheets({
          version: 'v4',
          auth: auth
        });
        
        console.log("Sheets client created successfully");
        
        // Make the API call with proper error handling
        try {
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: config.spreadsheetId,
            range: `${config.sheetName}!${config.dataRange}`
          });
          
          console.log("Sheets API call succeeded");
          
          // Process the data (simplified for now)
          const rows = response.data.values || [];
          console.log(`Found ${rows.length} rows of data`);

          // Get Firebase tracking data for this user
          console.log('Loading event tracking data from Firebase...');
          const trackingData = await getAllEventTracking(userId);
          console.log(`Loaded tracking for ${Object.keys(trackingData).length} events`);

          // Always explicitly construct and log the response
          // Add this code to your function to process the events from the sheet

// Process the sheet data
// Process the sheet data
const events = [];
const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/; // DD/MM/YY or DD/MM/YYYY

// Skip excluded event types if needed
const excludedEventTypes = ['הצעת מחיר', 'השכרות', 'הפקה', 'אופציה'];

// Columns mapping (adjust these based on your actual sheet)
const COLUMNS = {
  DATE: 1,          // Column B: Date (DD/MM/YY)
  DAY: 2,           // Column C: Day of week
  EVENT_TYPE_D: 3,  // Column D: Event Type Detail
  EVENT_TYPE: 4,    // Column E: Event Type
  TITLE: 5,         // Column F: Title
  LOCATION: 6,      // Column G: Location
  NOTES: 8,         // Column I: Notes
  START_TIME: 9,    // Column J: Start Time
  END_TIME: 10,     // Column K: End Time
  MANAGER: 11,      // Column L: Manager
  STATUS: 13,       // Column N: Status
  EQUIPMENT_URL: 13, // Column N: Also contains hyperlink
  TECHNICIANS: {    // Columns T-Z: Technicians
    START: 20,      // Column T (0-based index is 19)
    END: 26         // Column Z (0-based index is 25)
  }
};

// Define helper function to extract technicians
const extractTechnicians = (row) => {
  const technicians = [];
  
  for (let col = COLUMNS.TECHNICIANS.START; col <= COLUMNS.TECHNICIANS.END; col++) {
    if (row.length > col && row[col] && row[col].trim()) {
      technicians.push(row[col].trim());
    }
  }
  
  return technicians;
};

// First, let's process all rows that match our date range and criteria
// and keep track of which rows need hyperlink extraction
const relevantRows = [];
const rowsNeedingHyperlinks = [];

// Loop through each row in the spreadsheet to pre-filter
rows.forEach((row, rowIndex) => {
  // Skip rows that don't have enough data
  if (!row || row.length <= COLUMNS.DATE) {
    return;
  }
  
  // Skip rows that don't have a valid date
  if (!row[COLUMNS.DATE] || !dateRegex.test(row[COLUMNS.DATE])) {
    return;
  }
  
  // Skip excluded event types if needed
  const eventTypeD = row.length > COLUMNS.EVENT_TYPE_D ? row[COLUMNS.EVENT_TYPE_D] : '';
  if (excludedEventTypes.includes(eventTypeD)) {
    return;
  }
  
  // Parse date with improved format validation
  try {
    const dateMatch = row[COLUMNS.DATE].match(dateRegex);
    if (!dateMatch) {
      return;
    }
    
    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10) - 1; // JavaScript months are 0-indexed
    const year = parseInt(dateMatch[3], 10);
    const fullYear = year < 100 ? 2000 + year : year; // Handle 2-digit years
    
    // Validate date parts
    if (day < 1 || day > 31 || month < 0 || month > 11) {
      return;
    }
    
    // Create a date object for this event
    const eventDate = new Date(fullYear, month, day);
    
    // Skip events outside our timeframe
    if (eventDate < timeMin || eventDate > timeMax) {
      return;
    }
    
    // Check if the status is "on-going" or "done"
    const status = row.length > COLUMNS.STATUS ? (row[COLUMNS.STATUS] || '').toLowerCase() : '';
    const needsHyperlink = status === 'on-going' || status === 'done';
    
    // Store the relevant row with its index for later processing
    relevantRows.push({
      rowIndex,
      row,
      needsHyperlink,
      eventDate,
      day,
      month,
      year,
      fullYear,
      eventTypeD
    });
    
    // If this row needs a hyperlink, add it to our list
    if (needsHyperlink) {
      rowsNeedingHyperlinks.push(rowIndex);
    }
  } catch (error) {
    console.error(`Error processing row ${rowIndex}:`, error);
  }
});

console.log(`Found ${relevantRows.length} events in timeframe, ${rowsNeedingHyperlinks.length} need hyperlinks`);

// If we have rows that need hyperlinks, fetch only those specific cells
let hyperlinks = {};
if (rowsNeedingHyperlinks.length > 0) {
  try {
    // We'll only fetch the specific cells in column N that we need
    // This significantly reduces the amount of data compared to fetching the entire sheet
    const cellRanges = rowsNeedingHyperlinks.map(rowIndex => {
      // Convert to A1 notation (column N + row)
      // Add 1 for 0-based to 1-based conversion, and add header row offset
      const sheetRowIndex = rowIndex + 2; 
      return `${config.sheetName}!N${sheetRowIndex}`;
    });
    
    // Break up requests if we have too many cells to avoid hitting API limits
    // Process in batches of 50 cells
    const batchSize = 50;
    for (let i = 0; i < cellRanges.length; i += batchSize) {
      const batchRanges = cellRanges.slice(i, i + batchSize);
      
      // Use spreadsheets.get with includeGridData but only for specific cells
      const gridResponse = await sheets.spreadsheets.get({
        spreadsheetId: config.spreadsheetId,
        ranges: batchRanges,
        includeGridData: true
      });
      
      // Process the response and extract hyperlinks
      if (gridResponse.data && gridResponse.data.sheets) {
        gridResponse.data.sheets.forEach(sheet => {
          if (sheet.data) {
            sheet.data.forEach((gridData, gridIndex) => {
              if (gridData.rowData && gridData.rowData.length > 0) {
                const cellData = gridData.rowData[0];
                if (cellData.values && cellData.values.length > 0) {
                  const cell = cellData.values[0];
                  if (cell.hyperlink) {
                    // The batch range gives us the row index offset
                    const originalRowIndex = rowsNeedingHyperlinks[i + gridIndex];
                    hyperlinks[originalRowIndex] = cell.hyperlink;
                  }
                }
              }
            });
          }
        });
      }
      
      // To avoid hitting rate limits, add a small delay between batches
      if (i + batchSize < cellRanges.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`Successfully extracted ${Object.keys(hyperlinks).length} hyperlinks`);
  } catch (error) {
    console.error("Error fetching hyperlinks:", error);
    // Continue without hyperlinks if there's an error
  }
}
  // Now process all relevant rows and build the events array
  relevantRows.forEach(({ rowIndex, row, eventDate, day, month, year, fullYear, eventTypeD }) => {
  // Format date for display (DD/MM/YY)
  const formattedDate = `${day.toString().padStart(2, '0')}/${(month+1).toString().padStart(2, '0')}/${year < 100 ? year : year % 100}`;

  // Check if event should be marked as canceled
  const shouldCancel = row.length > 18 && (row[18] === true || row[18] === "true" || row[18] === "TRUE");
  const rawTitle = row.length > COLUMNS.TITLE ? (row[COLUMNS.TITLE] || '') : '';

  // Get tracking info from Firebase for this row
  const tracking = trackingData[rowIndex];

  // Create event object with all fields properly extracted
  const event = {
    rowIndex: rowIndex, // Add row index for frontend reference
    date: formattedDate,
    day: row.length > COLUMNS.DAY ? (row[COLUMNS.DAY] || '') : '',
    eventType: row.length > COLUMNS.EVENT_TYPE ? (row[COLUMNS.EVENT_TYPE] || '') : '',
    eventTypeD: eventTypeD,
    title: shouldCancel ? `Canceled: ${rawTitle}` : rawTitle,
    isCanceled: shouldCancel, // Add this flag to make it easy to detect in frontend
    location: row.length > COLUMNS.LOCATION ? (row[COLUMNS.LOCATION] || '') : '',
    notes: row.length > COLUMNS.NOTES ? (row[COLUMNS.NOTES] || '') : '',
    startTime: row.length > COLUMNS.START_TIME ? (row[COLUMNS.START_TIME] || '') : '',
    endTime: row.length > COLUMNS.END_TIME ? (row[COLUMNS.END_TIME] || '') : '',
    manager: row.length > COLUMNS.MANAGER ? (row[COLUMNS.MANAGER] || '') : '',
    equipmentListUrl: hyperlinks[rowIndex] || '',
    technicians: extractTechnicians(row),
    // Add Firebase tracking data
    eventId: tracking?.eventId || null,
    syncStatus: tracking?.status || null,
    lastSync: tracking?.lastSync ? tracking.lastSync.toDate() : null
  };

  events.push(event);

 
});

// Sort events by date
events.sort((a, b) => {
  // Parse dates for comparison (assuming DD/MM/YY format)
  const [dayA, monthA, yearA] = a.date.split('/').map(Number);
  const [dayB, monthB, yearB] = b.date.split('/').map(Number);
  
  // Handle 2-digit years consistently
  const fullYearA = yearA < 100 ? 2000 + yearA : yearA;
  const fullYearB = yearB < 100 ? 2000 + yearB : yearB;
  
  const dateA = new Date(fullYearA, monthA - 1, dayA);
  const dateB = new Date(fullYearB, monthB - 1, dayB);
  
  if (dateA.getTime() === dateB.getTime()) {
    // If same date, sort by start time
    return a.startTime.localeCompare(b.startTime);
  }
  
  return dateA - dateB;
});

console.log(`Processed ${events.length} events for ${timeframe}`);

// Return the processed events
const result = {
  success: true,
  events: events
};

console.log("Returning response with events:", events.length);
return result;
          
        } catch (sheetsError) {
          console.error("Error fetching spreadsheet data:", sheetsError);
          return {
            success: false,
            error: `Spreadsheet error: ${sheetsError.message}`
          };
        }
      } catch (authError) {
        console.error("Error with Google authentication:", authError);
        return {
          success: false,
          error: `Authentication error: ${authError.message}`
        };
      }
    } catch (error) {
      console.error("General error:", error);
      return {
        success: false,
        error: `Error: ${error.message}`
      };
    }
  });
  
  // Also create a HTTP version with CORS enabled for direct access if needed
  exports.getTimeframeEventsHttp = functions.https.onRequest((request, response) => {
    // Enable CORS using the cors middleware
    return cors(request, response, async () => {
      try {
        // Check for auth token in header
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          response.status(403).send({ success: false, error: 'Unauthorized access' });
          return;
        }
        
        const idToken = authHeader.split('Bearer ')[1];
        
        // Verify Firebase ID token
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;
        
        // Parse request data
        const timeframe = request.body.timeframe || request.query.timeframe || 'today';
        
        // Call the same logic as the Callable function
        const db = admin.firestore();
        const configDoc = await db.collection('configurations').doc(userId).get();
        
        if (!configDoc.exists) {
          response.status(400).send({
            success: false,
            error: 'Configuration not found. Please set up your calendar integration first.'
          });
          return;
        }
        
        // Same implementation as above...
        // (Implement the same logic as in the Callable function)
        
        // For brevity, just call a helper function that contains the shared logic
        const result = await getEvents(userId, timeframe);
        
        // Send response
        response.status(200).send(result);
        
      } catch (error) {
        console.error('Error in HTTP function:', error);
        response.status(500).send({
          success: false,
          error: `Server error: ${error.message}`
        });
      }
    });
  });
  


//////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////// Hakol Quote Function //////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////


  // Firebase function to fetch Google Sheet data and generate PDF
