import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FiCalendar, FiPrinter, FiInfo, FiFilter, FiClock, FiMapPin, FiUser, FiUsers, FiChevronLeft, FiChevronRight } from 'react-icons/fi';

// Common component for displaying events across different timeframe views
function EventsView({ timeframe, title, month, year }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [events, setEvents] = useState([]);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [filter, setFilter] = useState('');
  const [expandedView, setExpandedView] = useState(true);
  const timelineRef = useRef(null);
  
  // Get the Firebase Functions instance
  const functions = getFunctions();

  // Use useCallback to memoize the fetchEvents function
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Call the Cloud Function directly using Firebase v9 syntax
      console.log("Calling getTimeframeEvents with timeframe:", timeframe, "month:", month, "year:", year);
      const getTimeframeEventsFn = httpsCallable(functions, 'getTimeframeEvents');

      // Prepare the function parameters
      const params = { timeframe };
      if (month !== undefined && year !== undefined) {
        params.month = month;
        params.year = year;
      }

      // Add more detailed logging
      console.log("Before function call with params:", params);
      const result = await getTimeframeEventsFn(params);
      console.log("After function call, raw result:", JSON.stringify(result));
      
      // Function returned a Firebase error (common when function fails to execute)
      // These errors have code, message, and sometimes details properties but no data
      if (result && result.code && typeof result.message === 'string' && !result.data) {
        console.error('Firebase function error:', result);
        setError(`Function error: ${result.message}`);
        return;
      }
      
      // Handle different response scenarios
      if (!result) {
        console.error('Empty response received');
        setError('Failed to load events: No response from server');
      } else if (!result.data) {
        console.error('Response missing data property:', result);
        setError('Failed to load events: Invalid response from server (missing data)');
      } else if (typeof result.data.success !== 'boolean') {
        console.error('Response missing success flag:', result.data);
        setError('Failed to load events: Invalid response format (missing success flag)');
      } else if (result.data.success) {
        // Success case
        if (Array.isArray(result.data.events)) {
          console.log(`Successfully loaded ${result.data.events.length} events`);
          setEvents(result.data.events);
          setFilteredEvents(result.data.events);
        } else {
          console.error('Success response missing events array:', result.data);
          setEvents([]);
          setFilteredEvents([]);
        }
      } else {
        // Error case with success: false
        const errorMessage = result.data.error || 'Unknown error';
        console.error('Function returned error:', errorMessage);
        setError(`Failed to load events: ${errorMessage}`);
      }
    } catch (error) {
      // Handle any exceptions during the function call
      console.error('Exception during fetchEvents:', error);
      setError(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [timeframe, month, year, functions]); // Include timeframe, month, year and functions as dependencies

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]); // Now fetchEvents is the dependency

  // Apply filter to events
  useEffect(() => {
    if (!filter) {
      setFilteredEvents(events);
      return;
    }
    
    const lowercaseFilter = filter.toLowerCase();
    const filtered = events.filter(event => 
      (event.title && event.title.toLowerCase().includes(lowercaseFilter)) ||
      (event.eventType && event.eventType.toLowerCase().includes(lowercaseFilter)) ||
      (event.eventTypeD && event.eventTypeD.toLowerCase().includes(lowercaseFilter)) ||
      (event.location && event.location.toLowerCase().includes(lowercaseFilter)) ||
      (event.manager && event.manager.toLowerCase().includes(lowercaseFilter)) ||
      (event.technicians && event.technicians.some(tech => 
        tech.toLowerCase().includes(lowercaseFilter)
      ))
    );
    
    setFilteredEvents(filtered);
  }, [filter, events]);

  // Get color for event type
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
      default:
        return { bg: '#607D8B', text: '#FFFFFF' }; // Blue Grey with white text
    }
  };

  // Group events by date (fixed to ensure grouping works correctly)
  const groupEventsByDate = () => {
    const eventsByDate = {};
    
    filteredEvents.forEach(event => {
      // Ensure we're using the processed date format consistently
      const dateKey = event.date;
      
      if (!eventsByDate[dateKey]) {
        eventsByDate[dateKey] = [];
      }
      eventsByDate[dateKey].push(event);
    });
    
    // Sort the dates to ensure consistent order
    return Object.fromEntries(
      Object.entries(eventsByDate).sort(([dateA], [dateB]) => {
        // Parse DD/MM/YY format
        const [dayA, monthA, yearA] = dateA.split('/').map(Number);
        const [dayB, monthB, yearB] = dateB.split('/').map(Number);
        
        // Compare years first
        if (yearA !== yearB) return yearA - yearB;
        // Then months
        if (monthA !== monthB) return monthA - monthB;
        // Then days
        return dayA - dayB;
      })
    );
  };

  // Scroll horizontally for week/month views
  const handleScroll = (direction) => {
    if (timelineRef.current) {
      const scrollAmount = timelineRef.current.clientWidth * 0.8;
      
      // Adjust direction for RTL layout
      const isRTL = document.dir === 'rtl' || 
                    getComputedStyle(timelineRef.current).direction === 'rtl';
      
      // In RTL, scrolling works in the opposite direction
      const adjustedDirection = isRTL ? -direction : direction;
      
      // Apply the scroll
      timelineRef.current.scrollLeft += adjustedDirection * scrollAmount;
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <div className="loading-text">Loading events...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <div className="error-message">{error}</div>
        <button onClick={fetchEvents} className="retry-button">
          <FiCalendar /> Try Again
        </button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="no-events-container">
        <div className="no-events">No events found for this timeframe.</div>
        <button onClick={fetchEvents} className="refresh-button">
          <FiCalendar /> Refresh
        </button>
      </div>
    );
  }

  const eventsByDate = groupEventsByDate();
  const isMultiDay = timeframe === 'week' || timeframe === 'month' || timeframe === '3days';

  return (
    <>
      {/* Removed the events-view-container wrapper */}
      {isMultiDay && (
        <div className="timeline-controls">
          <button onClick={() => handleScroll(-1)} className="scroll-button left">
            <FiChevronLeft />
          </button>
          <button onClick={() => handleScroll(1)} className="scroll-button right">
            <FiChevronRight />
          </button>
        </div>
      )}

      <div className="events-timeline-wrapper">
        <div 
          ref={timelineRef}
          className={`events-timeline ${expandedView ? 'expanded' : ''}`}
        >
          <div className={`${isMultiDay ? 'multi-day-timeline' : 'single-day-container'}`}>
            {Object.entries(eventsByDate).map(([date, dayEvents]) => (
              <div key={date} className={`date-group ${isMultiDay ? 'date-column' : 'single-day-column'}`}>
                <div className="date-header">
                  <div className="date-info">
                    <div className="event-date">{date}</div>
                    <div className="event-day">{dayEvents[0]?.day || 'יום'}</div>
                  </div>
                  <div className="events-summary">
                    {dayEvents.length} אירועים
                  </div>
                </div>
                
                <div className="date-events">
                  {dayEvents.map((event, index) => {
                    const eventTypeColor = getEventTypeColor(event.eventTypeD);
                    return (
                      <div 
                        key={index} 
                        className="event-card"
                        data-type={event.eventTypeD}
                      >
                        <div className="event-type-header">
                          <span 
                            className="event-type-badge"
                            data-type={event.eventTypeD}
                            style={{ 
                              backgroundColor: eventTypeColor.bg,
                              color: eventTypeColor.text
                            }}
                          >
                            {event.eventTypeD}
                          </span>
                          <div className="event-title">
                            {event.eventType} {event.title ? `- ${event.title}` : ''}
                            {event.notes && (
                              <span 
                                className="note-indicator tooltip"
                              >
                                <FiInfo />
                                <span className="tooltip-text">{event.notes}</span>
                              </span>
                            )}
                          </div>
                          {/* Add status badge if present */}
                          {event.status && (
                            <span className={`status-badge ${event.status.toLowerCase()}`}>
                              {event.status}
                            </span>
                          )}
                        </div>
                        
                        <div className="event-details">
                          {/* Location */}
                          {event.location && (
                            <div className="event-detail-row">
                              <FiMapPin className="detail-icon" />
                              <strong>מיקום:</strong> {event.location}
                            </div>
                          )}
                          
                          {/* Time - Show placeholder if missing */}
                          <div className="event-detail-row">
                            <FiClock className="detail-icon" />
                            <strong>שעה:</strong> {event.startTime || 'לא צוין'}{event.startTime && event.endTime ? ' - ' : ''}{event.endTime || ''}
                          </div>
                          
                          {/* Manager */}
                          {event.manager && (
                            <div className="event-detail-row">
                              <FiUser className="detail-icon" />
                              <strong>מנהל אירוע:</strong> {event.manager}
                            </div>
                          )}
                          
                          {/* Technicians - Always display even if empty */}
                          <div className="event-detail-row technicians-section">
                            <FiUsers className="detail-icon" />
                            <div className="technicians-list">
                              {Array.isArray(event.technicians) && event.technicians.length > 0 ? (
                                event.technicians.map((tech, idx) => (
                                  <span key={idx} className="technician-badge">
                                    {tech}
                                  </span>
                                ))
                              ) : (
                                <span className="technician-badge empty-badge">
                                  לא צוינו טכנאים
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {/* Equipment List Button - Show appropriate version based on presence of URL */}
                          <div className="event-detail-row equipment-row">
                            {event.equipmentListUrl ? (
                              <a 
                                href={event.equipmentListUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="print-equipment-button"
                              >
                                <FiPrinter /> הדפס רשימת ציוד
                              </a>
                            ) : (
                              <span className="print-equipment-button disabled">
                                <FiPrinter /> אין רשימת ציוד
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default EventsView;