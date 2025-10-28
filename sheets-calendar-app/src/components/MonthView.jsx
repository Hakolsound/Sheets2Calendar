import React, { useState } from 'react';
import EventsView from './EventsView';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

function MonthView() {
  const [currentDate, setCurrentDate] = useState(new Date());

  const currentMonth = currentDate.getMonth() + 1; // getMonth() returns 0-11, we need 1-12
  const currentYear = currentDate.getFullYear();

  const handlePreviousMonth = () => {
    setCurrentDate(prevDate => {
      const newDate = new Date(prevDate);
      newDate.setMonth(newDate.getMonth() - 1);
      return newDate;
    });
  };

  const handleNextMonth = () => {
    setCurrentDate(prevDate => {
      const newDate = new Date(prevDate);
      newDate.setMonth(newDate.getMonth() + 1);
      return newDate;
    });
  };

  const monthNames = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
  ];

  return (
    <div className="month-view-container">
      <div className="month-navigation">
        <button onClick={handlePreviousMonth} className="month-nav-button">
          <FiChevronRight />
        </button>
        <div className="month-display">
          <h2>{monthNames[currentMonth - 1]} {currentYear}</h2>
        </div>
        <button onClick={handleNextMonth} className="month-nav-button">
          <FiChevronLeft />
        </button>
      </div>
      <EventsView
        timeframe="month"
        title={`${monthNames[currentMonth - 1]} ${currentYear} Events`}
        month={currentMonth}
        year={currentYear}
      />
    </div>
  );
}

export default MonthView;