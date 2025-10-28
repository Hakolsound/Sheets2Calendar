import React, { useState, useRef, useMemo } from 'react';
import { FiCalendar, FiChevronLeft, FiChevronRight, FiRefreshCw } from 'react-icons/fi';
import { useEvents } from '../hooks/useEvents';
import useUIStore from '../store/uiStore';

// Enhanced EventsView component using React Query
function EventsViewEnhanced({ timeframe, title }) {
  const [filter, setFilter] = useState('');
  const [expandedView, setExpandedView] = useState(true);
  const timelineRef = useRef(null);

  const { setFilterText } = useUIStore();

  // Use React Query hook for data fetching with automatic caching and refetching
  const { data: events = [], isLoading, isError, error, refetch } = useEvents(timeframe);

  // Memoized filtered events
  const filteredEvents = useMemo(() => {
    if (!filter) return events;

    const lowercaseFilter = filter.toLowerCase();
    return events.filter(event =>
      (event.title && event.title.toLowerCase().includes(lowercaseFilter)) ||
      (event.eventType && event.eventType.toLowerCase().includes(lowercaseFilter)) ||
      (event.eventTypeD && event.eventTypeD.toLowerCase().includes(lowercaseFilter)) ||
      (event.location && event.location.toLowerCase().includes(lowercaseFilter)) ||
      (event.manager && event.manager.toLowerCase().includes(lowercaseFilter)) ||
      (event.technicians && event.technicians.some(tech =>
        tech.toLowerCase().includes(lowercaseFilter)
      ))
    );
  }, [events, filter]);

  // Get color for event type
  const getEventTypeColor = (eventType) => {
    const colors = {
      'סטנדאפ': { bg: '#E6D4F0', text: '#000000' },
      'מצלמות': { bg: '#FFF2CC', text: '#000000' },
      'כנס': { bg: '#F8CEBD', text: '#000000' },
      'אולפן': { bg: '#E2F0D9', text: '#000000' },
      'שטח': { bg: '#5C3317', text: '#FFFFFF' },
      'חו"ל': { bg: '#FADBD8', text: '#000000' },
    };
    return colors[eventType] || { bg: '#607D8B', text: '#FFFFFF' };
  };

  // Group events by date - memoized for performance
  const eventsByDate = useMemo(() => {
    const grouped = {};

    filteredEvents.forEach(event => {
      const dateKey = event.date;
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(event);
    });

    // Sort dates
    return Object.fromEntries(
      Object.entries(grouped).sort(([dateA], [dateB]) => {
        const [dayA, monthA, yearA] = dateA.split('/').map(Number);
        const [dayB, monthB, yearB] = dateB.split('/').map(Number);

        if (yearA !== yearB) return yearA - yearB;
        if (monthA !== monthB) return monthA - monthB;
        return dayA - dayB;
      })
    );
  }, [filteredEvents]);

  // Scroll horizontally for multi-day views
  const handleScroll = (direction) => {
    if (!timelineRef.current) return;

    const scrollAmount = timelineRef.current.clientWidth * 0.8;
    const isRTL = document.dir === 'rtl' ||
                  getComputedStyle(timelineRef.current).direction === 'rtl';
    const adjustedDirection = isRTL ? -direction : direction;

    timelineRef.current.scrollLeft += adjustedDirection * scrollAmount;
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <div className="loading-text">Loading events...</div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="error-container">
        <div className="error-message">
          {error?.message || 'Failed to load events'}
        </div>
        <button onClick={() => refetch()} className="retry-button">
          <FiRefreshCw /> Try Again
        </button>
      </div>
    );
  }

  // Empty state
  if (events.length === 0) {
    return (
      <div className="no-events-container">
        <div className="no-events">No events found for this timeframe.</div>
        <button onClick={() => refetch()} className="refresh-button">
          <FiCalendar /> Refresh
        </button>
      </div>
    );
  }

  const isMultiDay = ['week', 'month', '3days'].includes(timeframe);

  return (
    <>
      {/* Filter input */}
      <div className="filter-container" style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="סנן אירועים..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="filter-input"
          style={{
            padding: '0.5rem',
            width: '100%',
            maxWidth: '400px',
            border: '1px solid #ddd',
            borderRadius: '4px',
          }}
        />
        {filteredEvents.length < events.length && (
          <span style={{ marginLeft: '1rem', color: '#666' }}>
            מציג {filteredEvents.length} מתוך {events.length} אירועים
          </span>
        )}
      </div>

      {/* Timeline controls for multi-day views */}
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

      {/* Events timeline */}
      <div className="events-timeline-wrapper">
        <div
          ref={timelineRef}
          className={`events-timeline ${expandedView ? 'expanded' : ''}`}
        >
          <div className={isMultiDay ? 'multi-day-timeline' : 'single-day-container'}>
            {Object.entries(eventsByDate).map(([date, dayEvents]) => (
              <div
                key={date}
                className={isMultiDay ? 'date-column' : 'single-day-column'}
              >
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
                        key={`${date}-${index}`}
                        className="event-card"
                        data-type={event.eventTypeD}
                      >
                        <div className="event-type-header">
                          <span
                            className="event-type-badge"
                            style={{
                              backgroundColor: eventTypeColor.bg,
                              color: eventTypeColor.text,
                              padding: '0.25rem 0.5rem',
                              borderRadius: '4px',
                              fontSize: '0.875rem',
                              fontWeight: 'bold',
                            }}
                          >
                            {event.eventTypeD}
                          </span>
                          {event.time && (
                            <span className="event-time">{event.time}</span>
                          )}
                        </div>

                        <div className="event-title">{event.title}</div>

                        {event.location && (
                          <div className="event-location">📍 {event.location}</div>
                        )}

                        {event.manager && (
                          <div className="event-manager">👤 {event.manager}</div>
                        )}

                        {event.technicians && event.technicians.length > 0 && (
                          <div className="event-technicians">
                            <strong>טכנאים:</strong> {event.technicians.join(', ')}
                          </div>
                        )}
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

export default EventsViewEnhanced;
