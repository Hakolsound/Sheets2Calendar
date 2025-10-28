import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { getAuth, signOut } from 'firebase/auth';
import { FiCalendar, FiSettings, FiMonitor, FiLogOut, FiMenu, FiX, FiFileText, FiPlus } from 'react-icons/fi';
import useAuthStore from '../store/authStore';

function Navbar() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showQuoteDropdown, setShowQuoteDropdown] = useState(false);
  const auth = getAuth();

  // Check if viewport is mobile
  useEffect(() => {
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth <= 767);
    };
    
    // Initial check
    checkIfMobile();
    
    // Add event listener for window resize
    window.addEventListener('resize', checkIfMobile);
    
    // Cleanup
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };

  const closeMenu = () => {
    setMenuOpen(false);
  };

  // Toggle quotes dropdown
  const toggleQuoteDropdown = (e) => {
    e.stopPropagation();
    setShowQuoteDropdown(!showQuoteDropdown);
  };

  // Function to open existing quote
  const openExistingQuote = (e) => {
    e.preventDefault();
    const quoteId = prompt('Enter quote ID:');
    if (quoteId) {
      navigate(`/quotes/${quoteId}`);
    }
    closeMenu();
  };

  // Function to check if a link is active
  const isActive = (path) => {
    if (path === '/quotes') {
      return location.pathname.startsWith('/quotes');
    }
    // Handle legacy routes that redirect to /control
    if (path === '/control') {
      return location.pathname === '/control' ||
             location.pathname === '/setup' ||
             location.pathname === '/monitor';
    }
    return location.pathname === path;
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowQuoteDropdown(false);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <>
      <nav className="navbar">
        {/* Menu toggle button for mobile */}
        {isMobile && (
          <button className="menu-toggle" onClick={toggleMenu}>
            {menuOpen ? <FiX /> : <FiMenu />}
          </button>
        )}
        
        <div className="navbar-brand">
          <Link to="/" onClick={closeMenu}>
            <strong>Fine AV</strong>
            {!isMobile && <span> Services</span>}
          </Link>
        </div>
        
        {/* Only show the regular navbar menu on non-mobile devices */}
        {!isMobile && (
          <div className={`navbar-menu ${menuOpen ? 'is-active' : ''}`}>
            <div className="navbar-section">
              <Link 
                to="/today" 
                className={`navbar-item ${isActive('/today') ? 'active' : ''}`} 
                onClick={closeMenu}
              >
                <FiCalendar /> Today
              </Link>
              <Link 
                to="/3days" 
                className={`navbar-item ${isActive('/3days') ? 'active' : ''}`} 
                onClick={closeMenu}
              >
                <FiCalendar /> 3 Days
              </Link>
              <Link 
                to="/week" 
                className={`navbar-item ${isActive('/week') ? 'active' : ''}`} 
                onClick={closeMenu}
              >
                <FiCalendar /> Week
              </Link>
              <Link 
                to="/month" 
                className={`navbar-item ${isActive('/month') ? 'active' : ''}`} 
                onClick={closeMenu}
              >
                <FiCalendar /> Month
              </Link>
            </div>
            
            <div className="navbar-section">
              {/* Quote dropdown */}
              <div className="dropdown-container" onClick={(e) => e.stopPropagation()}>
                <div 
                  className={`navbar-item ${isActive('/quotes') ? 'active' : ''}`}
                  onClick={toggleQuoteDropdown}
                >
                  <FiFileText /> Quotes <span className="dropdown-arrow">▼</span>
                </div>
                {showQuoteDropdown && (
                  <div className="dropdown-menu">
                    <Link 
                      to="/quotes/new" 
                      className="dropdown-item"
                      onClick={() => {
                        setShowQuoteDropdown(false);
                        closeMenu();
                      }}
                    >
                      <FiPlus /> New Quote
                    </Link>
                    <a 
                      href="#" 
                      className="dropdown-item"
                      onClick={openExistingQuote}
                    >
                      <FiFileText /> Open Quote
                    </a>
                  </div>
                )}
              </div>
              
              <Link
                to="/control"
                className={`navbar-item ${isActive('/control') ? 'active' : ''}`}
                onClick={closeMenu}
              >
                <FiSettings /> Control Center
              </Link>
            </div>
          </div>
        )}
        
        <div className="navbar-end">
          <div className="navbar-item user-info">
            <img 
              src={user?.photoURL || 'https://hakolsound.co.il/wp-content/uploads/2020/06/hakol-logo.png'} 
              alt={user?.displayName || 'User'} 
              className="user-avatar" 
            />
            <span className="user-name">{user?.displayName || 'User'}</span>
          </div>
          <button onClick={handleLogout} className="logout-button">
            <FiLogOut /> {!isMobile && "Logout"}
          </button>
        </div>
      </nav>
      
      {/* Mobile bottom tab navigation - fixed position */}
      {isMobile && (
        <div className="tab-bar">
          <Link 
            to="/today" 
            className={`tab-item ${isActive('/today') ? 'active' : ''}`}
          >
            <FiCalendar />
            <span>Today</span>
          </Link>
          <Link 
            to="/3days" 
            className={`tab-item ${isActive('/3days') ? 'active' : ''}`}
          >
            <FiCalendar />
            <span>3 Days</span>
          </Link>
          <Link 
            to="/week" 
            className={`tab-item ${isActive('/week') ? 'active' : ''}`}
          >
            <FiCalendar />
            <span>Week</span>
          </Link>
          <Link 
            to="/quotes/new" 
            className={`tab-item ${isActive('/quotes') ? 'active' : ''}`}
          >
            <FiFileText />
            <span>Quotes</span>
          </Link>
          <Link
            to="/control"
            className={`tab-item ${isActive('/control') ? 'active' : ''}`}
          >
            <FiSettings />
            <span>Control</span>
          </Link>
        </div>
      )}
      
      {/* Mobile expanded menu overlay */}
      {isMobile && menuOpen && (
        <div className={`navbar-menu expanded`}>
          {/* Quote options in expanded menu */}
          <div className="navbar-subheader">Quotes</div>
          <Link 
            to="/quotes/new" 
            className={`navbar-item ${isActive('/quotes/new') ? 'active' : ''}`} 
            onClick={closeMenu}
          >
            <FiPlus /> New Quote
          </Link>
          <a 
            href="#" 
            className="navbar-item" 
            onClick={(e) => {
              openExistingQuote(e);
            }}
          >
            <FiFileText /> Open Quote
          </a>
        </div>
      )}
    </>
  );
}



// Add this CSS to your existing CSS file or create a new one
// If adding to a new file, import it in the component
/*
.dropdown-container {
  position: relative;
  display: inline-block;
}

.dropdown-trigger {
  cursor: pointer;
}

.dropdown-arrow {
  font-size: 10px;
  margin-left: 5px;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background-color: white;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  border-radius: 4px;
  min-width: 180px;
  z-index: 1000;
}

.dropdown-item {
  display: flex;
  align-items: center;
  padding: 10px 15px;
  color: #333;
  text-decoration: none;
  transition: background-color 0.2s;
}

.dropdown-item:hover {
  background-color: #f5f5f5;
}

.dropdown-item svg {
  margin-right: 8px;
}

.navbar-subheader {
  padding: 10px 15px;
  font-weight: bold;
  color: #666;
  font-size: 0.9em;
  border-bottom: 1px solid #eee;
}
*/

export default Navbar;