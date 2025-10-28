import React from 'react';
import EventsView from './EventsView';

function TodayView() {
  return <EventsView timeframe="today" title="Today's Events" />;
}

export default TodayView;