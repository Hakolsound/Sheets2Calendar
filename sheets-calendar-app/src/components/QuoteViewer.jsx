import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import './QuoteViewer.css';
import { generatePDF, createPrintableQuote, uploadLogoToFirebase } from '../utils/pdfGenerator';

// Simple HTML-based Quote Viewer with PDF generation capability
const QuoteViewer = ({ user }) => {
  const { quoteId } = useParams();
  const [quoteData, setQuoteData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [logoUrl, setLogoUrl] = useState('./hkl.png');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const quoteContainerRef = useRef(null);

  // Get Firebase instances
  const db = getFirestore();
  const functions = getFunctions();

  // Fetch quote data from Firestore
  useEffect(() => {
    const fetchQuoteData = async () => {
      try {
        setLoading(true);

        // For demo, use mock data if no quoteId (new quote)
        if (!quoteId || quoteId === 'new') {
          setQuoteData(MOCK_QUOTE);
          setLoading(false);
          return;
        }
        
        // Fetch from Firestore
        const quoteRef = doc(db, 'quotes', quoteId);
        const quoteSnapshot = await getDoc(quoteRef);
        
        if (quoteSnapshot.exists()) {
          const data = quoteSnapshot.data();
          setQuoteData(data);
          // If the quote has a custom logo URL, use it
          if (data.logoUrl) {
            setLogoUrl(data.logoUrl);
          }
        } else {
          setError('הצעת המחיר לא נמצאה');
        }
      } catch (err) {
        console.error('Error fetching quote:', err);
        setError(`שגיאה בטעינת הצעת המחיר: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchQuoteData();
  }, [quoteId, db]);

  // Handle logo upload
  const handleLogoUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      setUploading(true);
      
      // Upload to Firebase Storage
      const uploadedLogoUrl = await uploadLogoToFirebase(file);
      
      // Update the state
      setLogoUrl(uploadedLogoUrl);
      
      // If this is an existing quote, update the logo URL in Firestore
      if (quoteId && quoteId !== 'new') {
        const quoteRef = doc(db, 'quotes', quoteId);
        await updateDoc(quoteRef, {
          logoUrl: uploadedLogoUrl,
          updatedAt: serverTimestamp()
        });
      }
      
      alert('הלוגו הועלה בהצלחה');
    } catch (err) {
      console.error('Error uploading logo:', err);
      alert(`שגיאה בהעלאת הלוגו: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Handle email sending
  const handleSendEmail = async () => {
    try {
      setSending(true);
      
      // Generate PDF first
      await handleSaveAsPdf();
      
      // Example Firebase function call
      const sendQuoteEmail = httpsCallable(functions, 'sendQuoteEmail');
      const result = await sendQuoteEmail({ quoteId });
      
      if (result.data.success) {
        alert('הצעת המחיר נשלחה בהצלחה');
      } else {
        alert(`שגיאה בשליחת המייל: ${result.data.error}`);
      }
    } catch (err) {
      console.error('Error sending quote:', err);
      alert(`שגיאה: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  // Handle PDF generation and saving
// Add this function to your QuoteViewer.jsx component

/**
 * Creates a PDF with the quote content, handling all image issues
 */
const handleSaveAsPdf = async () => {
    try {
      // 1. Pre-download any remote images to avoid CORS issues
      const logoImg = new Image();
      const logoLoadPromise = new Promise((resolve) => {
        logoImg.onload = () => {
          // Create canvas and convert to data URL
          const canvas = document.createElement('canvas');
          canvas.width = logoImg.width || 300; // Default if width not available
          canvas.height = logoImg.height || 150; // Default if height not available
          
          // Draw image to canvas
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF'; // White background
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(logoImg, 0, 0);
          
          // Get data URL
          resolve(canvas.toDataURL('image/png'));
        };
        
        logoImg.onerror = () => {
          console.warn('Failed to load logo, using default');
          resolve('/hkl.png');
        };
        
        // Set crossOrigin to anonymous to try to avoid CORS issues
        logoImg.crossOrigin = 'anonymous';
      });
      
      // Set a timeout in case image loading hangs
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
          console.warn('Logo loading timed out');
          resolve('/default-logo.png');
        }, 3000);
      });
      
      // Start loading the logo
      logoImg.src = quoteData.logoUrl || '/default-logo.png'; 
      
      // Wait for logo to load or timeout
      const processedLogoUrl = await Promise.race([logoLoadPromise, timeoutPromise]);
      console.log('Using processed logo URL:', processedLogoUrl.substring(0, 50) + '...');
      
      // 2. Create the printable quote with the data URL
      const printContainer = createPrintableQuote({
        ...quoteData,
        // Use the processed logo URL instead of the original
      }, processedLogoUrl);
      
      // 3. Generate the PDF
      const success = await generatePDF(printContainer, 'quote.pdf');
      
      if (success) {
        console.log('PDF generated successfully');
      } else {
        console.error('Failed to generate PDF');
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF. Please try again later.');
    }
  };

  if (loading) {
    return <div className="loading">טוען הצעת מחיר...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!quoteData) {
    return <div className="error">לא נמצאו נתונים להצעת המחיר</div>;
  }

  return (
    <div className="quote-viewer-container" dir="rtl">
      <div className="quote-header">
        <h1>הצעת מחיר: {quoteData.eventInfo.name}</h1>
        <div className="action-buttons">
          <button 
            className="btn btn-outline" 
            onClick={() => fileInputRef.current.click()}
            disabled={uploading}
          >
            {uploading ? 'מעלה לוגו...' : 'החלף לוגו'}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept="image/*"
            onChange={handleLogoUpload}
          />
          <button 
            className="btn btn-primary" 
            onClick={handleSaveAsPdf}
            disabled={generating}
          >
            {generating ? 'מייצר PDF...' : 'שמור כ-PDF'}
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={handleSendEmail}
            disabled={sending || generating}
          >
            {sending ? 'שולח...' : 'שלח ללקוח'}
          </button>
        </div>
      </div>

      <div className="logo-preview">
        <p>לוגו נוכחי (יופיע כרקע בהצעת המחיר):</p>
        <img src={logoUrl} alt="Company Logo" className="logo-image" />
      </div>

      {/* Quote content - this is the visible version in the UI */}
      <div ref={quoteContainerRef} className="quote-content">
        {/* Client Details */}
        <div className="client-details card">
          <h3>פרטי לקוח</h3>
          <div className="detail-row">
            <strong>שם:</strong> {quoteData.clientInfo.name}
          </div>
          <div className="detail-row">
            <strong>חברה:</strong> {quoteData.clientInfo.companyName}
          </div>
          <div className="detail-row">
            <strong>דוא"ל:</strong> {quoteData.clientInfo.email}
          </div>
          {quoteData.clientInfo.phone && (
            <div className="detail-row">
              <strong>טלפון:</strong> {quoteData.clientInfo.phone}
            </div>
          )}
        </div>

        {/* Event Details */}
        <div className="event-details card">
          <h3>פרטי אירוע</h3>
          <div className="detail-row">
            <strong>שם האירוע:</strong> {quoteData.eventInfo.name}
          </div>
          <div className="detail-row">
            <strong>מיקום:</strong> {quoteData.eventInfo.location}
          </div>
          <div className="detail-row">
            <strong>תאריך:</strong> {quoteData.eventInfo.date}
          </div>
          {quoteData.eventInfo.days && (
            <div className="detail-row">
              <strong>ימים:</strong> {quoteData.eventInfo.days}
            </div>
          )}
          {quoteData.eventInfo.setupDate && (
            <div className="detail-row">
              <strong>תאריך הקמה:</strong> {quoteData.eventInfo.setupDate}
            </div>
          )}
        </div>

        {/* Quote Sections */}
        {quoteData.sections && quoteData.sections.map((section, index) => (
          <div key={index} className="quote-section">
            {section.type === 'venue' ? (
              <div className="venue-section">
                <h3>{section.name}</h3>
                {section.description && <p>{section.description}</p>}
              </div>
            ) : (
              <div className="items-section">
                <h3>{section.name}</h3>
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>פריט</th>
                      <th>כמות</th>
                      <th>מחיר</th>
                      <th>ימים</th>
                      <th>סה"כ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.items && section.items.map((item, itemIndex) => (
                      <tr key={itemIndex}>
                        <td>{item.name}</td>
                        <td>{item.quantity}</td>
                        <td>{quoteData.currencySymbol}{item.unitPrice}</td>
                        <td>{item.days}</td>
                        <td>{quoteData.currencySymbol}{item.total}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="4" className="section-total">סה"כ {section.name}</td>
                      <td className="section-total-value">
                        {quoteData.currencySymbol}
                        {section.items?.reduce((sum, item) => sum + Number(item.total), 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        ))}

        {/* Totals */}
        <div className="quote-totals">
          {quoteData.totals.specialDiscount > 0 && (
            <div className="discount-row">
              <span className="total-label">הנחה מיוחדת:</span>
              <span className="total-value">
                {quoteData.currencySymbol}{quoteData.totals.specialDiscount}
              </span>
            </div>
          )}
          <div className="total-row">
            <span className="total-label">סה"כ ללא מע"מ:</span>
            <span className="total-value">
              {quoteData.currencySymbol}{quoteData.totals.finalTotal}
            </span>
          </div>
          <div className="terms">
            <strong>תנאי תשלום:</strong> {quoteData.paymentTerms || 'שוטף + 30'}
          </div>
        </div>
      </div>
    </div>
  );
};

// Mock data for testing
const MOCK_QUOTE = {
  quoteId: "test123",
  clientInfo: {
    name: "נועה שבת",
    email: "noas@kldltd.com",
    companyName: "קליידסקופ בע\"מ",
    phone: "050-1234567"
  },
  eventInfo: {
    name: "כנס המטולוגיה",
    location: "מוזיאון אנו",
    date: "15/05/2025",
    days: "2",
    setupDate: "14/05/2025",
    description: "כנס רפואי מקצועי"
  },
  producerInfo: {
    name: "נועה שבת",
    email: "noas@kldltd.com"
  },
  sections: [
    {
      type: "venue",
      name: "מתחם מליאה",
      description: "הקמות וטסטים בערב לפני האירוע"
    },
    {
      name: "סאונד",
      items: [
        {
          quantity: 2,
          name: "ממשק USB DI",
          unitPrice: 80,
          days: 1,
          total: 160
        },
        {
          quantity: 2,
          name: "סט אלחוטי Shure ULXD תדרים חדשים",
          unitPrice: 220,
          days: 1,
          total: 440
        }
      ]
    },
    {
      name: "תאורה",
      items: [
        {
          quantity: 1,
          name: "מחשב תאורה GrandMA 3",
          unitPrice: 850,
          days: 1,
          total: 850
        },
        {
          quantity: 12,
          name: "פנס אפלייט לד",
          unitPrice: 65,
          days: 1,
          total: 780
        }
      ]
    }
  ],
  totals: {
    subtotal: 2230,
    finalTotal: 2230
  },
  currencySymbol: "₪",
  paymentTerms: "שוטף + 60"
};

export default QuoteViewer;