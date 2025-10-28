// src/utils/pdfGenerator.js
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Refined corporate color palette
const colors = {
  primary: '#0A2463',      // Deep navy blue
  secondary: '#3E92CC',    // Medium blue
  accent: '#2B9348',       // Rich green
  dark: '#1A1A2E',         // Dark blue-black
  light: '#F8F9FA',        // Off-white
  white: '#FFFFFF',
  text: '#1A1A2E',
  textLight: '#6C757D',    // Medium gray
  highlight: '#D4AF37',    // Gold
  gradient: {
    start: '#0A2463',      // Deep navy blue
    end: '#3E92CC'         // Medium blue
  }
};

/**
 * Uploads a logo to Firebase Storage
 * @param {File} logoFile - The file to upload
 * @returns {Promise<string>} - The download URL
 */
export const uploadLogoToFirebase = async (logoFile) => {
  try {
    const storage = getStorage();
    const storageRef = ref(storage, `logos/${logoFile.name}`);
    
    // Upload the file
    const snapshot = await uploadBytes(storageRef, logoFile);
    
    // Get download URL
    const downloadURL = await getDownloadURL(snapshot.ref);
    return downloadURL;
  } catch (error) {
    console.error('Error uploading logo:', error);
    throw error;
  }
};

/**
 * Generates a PDF from an HTML element
 * @param {HTMLElement} element - The element to convert to PDF
 * @param {string} filename - The filename for the PDF
 * @param {Object} options - Additional options
 */
export const generatePDF = async (element, filename = 'quote.pdf', options = {}) => {
  if (!element) {
    console.error('No element provided to generate PDF');
    return;
  }

  try {
    // Show a loading indicator with enhanced styling
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'pdf-loading-indicator';
    loadingIndicator.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text">מייצר מסמך PDF...</div>
    `;
    loadingIndicator.style.position = 'fixed';
    loadingIndicator.style.top = '0';
    loadingIndicator.style.left = '0';
    loadingIndicator.style.width = '100%';
    loadingIndicator.style.height = '100%';
    loadingIndicator.style.backgroundColor = 'rgba(26, 26, 46, 0.85)'; // Darker and more opaque
    loadingIndicator.style.display = 'flex';
    loadingIndicator.style.flexDirection = 'column';
    loadingIndicator.style.justifyContent = 'center';
    loadingIndicator.style.alignItems = 'center';
    loadingIndicator.style.zIndex = '9999';
    
    // Enhanced loading spinner
    const spinner = loadingIndicator.querySelector('.loading-spinner');
    if (spinner) {
      spinner.style.width = '50px';
      spinner.style.height = '50px';
      spinner.style.border = '3px solid rgba(255, 255, 255, 0.3)';
      spinner.style.borderTop = `3px solid ${colors.accent}`;
      spinner.style.borderRadius = '50%';
      spinner.style.animation = 'spin 1s linear infinite';
    }
    
    // Enhanced loading text
    const loadingText = loadingIndicator.querySelector('.loading-text');
    if (loadingText) {
      loadingText.style.marginTop = '15px';
      loadingText.style.color = colors.white;
      loadingText.style.fontWeight = '500';
      loadingText.style.fontSize = '16px';
      loadingText.style.letterSpacing = '0.5px';
    }
    
    // Add animation style
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(styleElement);
    document.body.appendChild(loadingIndicator);

    // Configure canvas with higher quality
    const canvas = await html2canvas(element, {
      scale: 3, // Higher scale for better quality
      useCORS: true,
      logging: false,
      allowTaint: true,
      backgroundColor: colors.white,
      ...options.canvasOptions
    });

    // Create PDF (A4 size)
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgData = canvas.toDataURL('image/png');
    
    // Get dimensions
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const canvasRatio = canvas.height / canvas.width;
    
    // Calculate image dimensions to maintain aspect ratio within A4
    let imgWidth = pdfWidth;
    let imgHeight = pdfWidth * canvasRatio;
    
    // If the height exceeds the page, we need to split it into multiple pages
    if (imgHeight > pdfHeight) {
      // Calculate how many pages we need
      const pageCount = Math.ceil(imgHeight / pdfHeight);
      
      // For each page, add a slice of the image
      for (let i = 0; i < pageCount; i++) {
        // Add a new page if it's not the first page
        if (i > 0) {
          pdf.addPage();
        }
        
        // Calculate the slice of the canvas for this page
        const sourceY = (canvas.height / pageCount) * i;
        const sourceHeight = canvas.height / pageCount;
        
        // Create a temporary canvas for this slice
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = sourceHeight;
        
        // Draw the slice of the original canvas onto the temporary canvas
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(
          canvas, 
          0, sourceY, canvas.width, sourceHeight,
          0, 0, tempCanvas.width, tempCanvas.height
        );
        
        // Add the temporary canvas to the PDF
        const sliceData = tempCanvas.toDataURL('image/png');
        pdf.addImage(sliceData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      }
    } else {
      // Image fits on a single page
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
    }
    
    // Save the PDF
    pdf.save(filename);
    
    // Remove loading indicator
    document.body.removeChild(loadingIndicator);
    document.head.removeChild(styleElement);
    
    return true;
  } catch (error) {
    console.error('Error generating PDF:', error);
    
    // Remove loading indicator if there was an error
    const loadingIndicator = document.querySelector('.pdf-loading-indicator');
    if (loadingIndicator) {
      document.body.removeChild(loadingIndicator);
    }
    
    // Remove style element if it exists
    const styleElement = document.querySelector('style');
    if (styleElement && styleElement.textContent.includes('@keyframes spin')) {
      document.head.removeChild(styleElement);
    }
    
    return false;
  }
};

/**
 * Creates an epic corporate-style printable quote template
 * @param {Object} quoteData - The quote data
 * @param {string} logoUrl - The URL of the company logo for the watermark
 */
export const createPrintableQuote = (quoteData, logoUrl = '/logo512.png') => {
  // Create a new element that will be used for PDF generation
  const printContainer = document.createElement('div');
  printContainer.className = 'quote-printable';
  printContainer.dir = 'rtl';
  printContainer.style.width = '210mm'; // A4 width
  printContainer.style.height = '297mm'; // A4 height
  printContainer.style.margin = '0';
  printContainer.style.padding = '0';
  printContainer.style.backgroundColor = colors.white;
  printContainer.style.fontFamily = 'Helvetica, Arial, sans-serif';
  printContainer.style.position = 'absolute';
  printContainer.style.left = '-9999px';
  printContainer.style.color = colors.text;
  printContainer.style.boxSizing = 'border-box';
  printContainer.style.overflow = 'hidden';
  
  // Add large logo watermark in the bottom left, spilling out 40%
  const watermark = document.createElement('div');
  watermark.style.position = 'absolute';
  watermark.style.bottom = '-40%'; // Spilling out 40%
  watermark.style.left = '-40%';   // Bottom left positioning
  watermark.style.width = '50%';   // 50% of page size
  watermark.style.height = '50%';  // 50% of page size
  watermark.style.opacity = '0.15'; // Subtle watermark
  watermark.style.backgroundImage = `url(${logoUrl})`;
  watermark.style.backgroundSize = 'contain';
  watermark.style.backgroundRepeat = 'no-repeat';
  watermark.style.backgroundPosition = 'bottom left';
  watermark.style.zIndex = '1';
  watermark.style.transform = 'rotate(-5deg)'; // Slight rotation for artistic touch
  printContainer.appendChild(watermark);
  
  // Add a subtle gradient accent on top
  const topAccent = document.createElement('div');
  topAccent.style.position = 'absolute';
  topAccent.style.top = '0';
  topAccent.style.left = '0';
  topAccent.style.right = '0';
  topAccent.style.height = '15mm';
  topAccent.style.background = `linear-gradient(90deg, ${colors.gradient.start}, ${colors.gradient.end})`;
  topAccent.style.zIndex = '1';
  printContainer.appendChild(topAccent);
  
  // Add a subtle gold accent line below the gradient
  const accentLine = document.createElement('div');
  accentLine.style.position = 'absolute';
  accentLine.style.top = '15mm';
  accentLine.style.left = '0';
  accentLine.style.right = '0';
  accentLine.style.height = '1mm';
  accentLine.style.backgroundColor = colors.highlight;
  accentLine.style.zIndex = '1';
  printContainer.appendChild(accentLine);
  
  // Content container with full bleed design
  const contentContainer = document.createElement('div');
  contentContainer.style.position = 'relative';
  contentContainer.style.zIndex = '2';
  contentContainer.style.padding = '25mm 15mm 15mm 15mm'; // Extra padding at top for the accent
  contentContainer.style.width = '100%';
  contentContainer.style.height = '100%';
  contentContainer.style.boxSizing = 'border-box';
  
  // Event name at the top with full width
  const eventHeader = document.createElement('div');
  eventHeader.style.marginBottom = '25px';
  eventHeader.style.position = 'relative';
  
  // Gold dash accent before title
  const titleAccent = document.createElement('div');
  titleAccent.style.position = 'absolute';
  titleAccent.style.top = '20px';
  titleAccent.style.right = '0';
  titleAccent.style.width = '25px';
  titleAccent.style.height = '3px';
  titleAccent.style.backgroundColor = colors.highlight;
  eventHeader.appendChild(titleAccent);
  
  const eventName = document.createElement('h1');
  eventName.style.fontSize = '42px';
  eventName.style.fontWeight = '800';
  eventName.style.margin = '0';
  eventName.style.color = colors.primary;
  eventName.style.letterSpacing = '-0.5px';
  eventName.style.paddingRight = '35px'; // Space for the accent dash
  eventName.textContent = quoteData.eventInfo.name;
  eventHeader.appendChild(eventName);
  
  const eventSubtitle = document.createElement('div');
  eventSubtitle.style.fontSize = '16px';
  eventSubtitle.style.color = colors.secondary;
  eventSubtitle.style.marginTop = '8px';
  eventSubtitle.style.fontWeight = '500';
  eventSubtitle.style.letterSpacing = '0.5px';
  eventSubtitle.textContent = `${quoteData.eventInfo.location} | ${quoteData.eventInfo.date}`;
  eventHeader.appendChild(eventSubtitle);
  
  contentContainer.appendChild(eventHeader);
  
  // Main content layout
  const mainContent = document.createElement('div');
  mainContent.style.display = 'flex';
  mainContent.style.justifyContent = 'space-between';
  mainContent.style.gap = '25px';
  
  // Client details in top right with enhanced styling
  const clientDetailsSection = document.createElement('div');
  clientDetailsSection.style.width = '25%';
  clientDetailsSection.style.backgroundColor = colors.light;
  clientDetailsSection.style.padding = '20px';
  clientDetailsSection.style.borderRadius = '8px';
  clientDetailsSection.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.05)';
  clientDetailsSection.style.border = `1px solid rgba(0, 0, 0, 0.05)`;
  
  const clientHeader = document.createElement('h3');
  clientHeader.style.margin = '0 0 15px 0';
  clientHeader.style.fontSize = '18px';
  clientHeader.style.fontWeight = '700';
  clientHeader.style.color = colors.primary;
  clientHeader.style.borderBottom = `2px solid ${colors.highlight}`;
  clientHeader.style.paddingBottom = '8px';
  clientHeader.textContent = 'פרטי לקוח';
  clientDetailsSection.appendChild(clientHeader);
  
  const clientInfo = document.createElement('div');
  clientInfo.style.fontSize = '14px';
  clientInfo.style.lineHeight = '1.7';
  clientInfo.innerHTML = `
    <div style="margin-bottom: 8px;"><strong style="color: ${colors.secondary};">שם:</strong> ${quoteData.clientInfo.name}</div>
    <div style="margin-bottom: 8px;"><strong style="color: ${colors.secondary};">חברה:</strong> ${quoteData.clientInfo.companyName}</div>
    <div style="margin-bottom: 8px;"><strong style="color: ${colors.secondary};">דוא"ל:</strong> ${quoteData.clientInfo.email}</div>
    ${quoteData.clientInfo.phone ? `<div style="margin-bottom: 8px;"><strong style="color: ${colors.secondary};">טלפון:</strong> ${quoteData.clientInfo.phone}</div>` : ''}
    ${quoteData.producerInfo?.name ? `<div style="margin-bottom: 8px;"><strong style="color: ${colors.secondary};">מפיק/ה:</strong> ${quoteData.producerInfo.name}</div>` : ''}
  `;
  clientDetailsSection.appendChild(clientInfo);
  
  // Items section (majority of the page)
  const itemsSection = document.createElement('div');
  itemsSection.style.width = '75%';
  
  // Add each section
  quoteData.sections.forEach((section, index) => {
    if (section.type === 'venue') {
      // Venue section with enhanced styling
      const venueSection = document.createElement('div');
      venueSection.style.marginBottom = '25px';
      venueSection.style.backgroundColor = colors.light;
      venueSection.style.borderRadius = '8px';
      venueSection.style.padding = '20px';
      venueSection.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.05)';
      venueSection.style.border = `1px solid rgba(0, 0, 0, 0.05)`;
      venueSection.style.position = 'relative';
      
      // Accent element
      const venueAccent = document.createElement('div');
      venueAccent.style.position = 'absolute';
      venueAccent.style.top = '0';
      venueAccent.style.right = '0';
      venueAccent.style.width = '8px';
      venueAccent.style.height = '100%';
      venueAccent.style.borderRadius = '0 8px 8px 0';
      venueAccent.style.background = `linear-gradient(to bottom, ${colors.primary}, ${colors.secondary})`;
      venueSection.appendChild(venueAccent);
      
      const venueHeader = document.createElement('h3');
      venueHeader.style.margin = '0 0 12px 0';
      venueHeader.style.fontSize = '18px';
      venueHeader.style.fontWeight = '700';
      venueHeader.style.color = colors.primary;
      venueHeader.style.paddingRight = '15px'; // Space for the accent bar
      venueHeader.textContent = section.name;
      venueSection.appendChild(venueHeader);
      
      if (section.description) {
        const venueDesc = document.createElement('p');
        venueDesc.style.margin = '0';
        venueDesc.style.fontSize = '14px';
        venueDesc.style.color = colors.textLight;
        venueDesc.style.paddingRight = '15px'; // Space for the accent bar
        venueDesc.textContent = section.description;
        venueSection.appendChild(venueDesc);
      }
      
      itemsSection.appendChild(venueSection);
    } else if (section.items && section.items.length > 0) {
      // Items section with enhanced styling
      const sectionContainer = document.createElement('div');
      sectionContainer.style.marginBottom = '30px';
      sectionContainer.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.08)';
      sectionContainer.style.borderRadius = '8px';
      sectionContainer.style.overflow = 'hidden'; // Ensure rounded corners for the table
      
      // Section header with gradient
      const sectionHeader = document.createElement('div');
      sectionHeader.style.background = `linear-gradient(90deg, ${colors.gradient.start}, ${colors.gradient.end})`;
      sectionHeader.style.color = colors.white;
      sectionHeader.style.padding = '12px 20px';
      sectionHeader.style.fontWeight = 'bold';
      sectionHeader.style.fontSize = '16px';
      sectionHeader.style.letterSpacing = '0.5px';
      sectionHeader.style.display = 'flex';
      sectionHeader.style.alignItems = 'center';
      
      // Gold accent dot before section name
      const sectionDot = document.createElement('span');
      sectionDot.style.display = 'inline-block';
      sectionDot.style.width = '8px';
      sectionDot.style.height = '8px';
      sectionDot.style.borderRadius = '50%';
      sectionDot.style.backgroundColor = colors.highlight;
      sectionDot.style.marginLeft = '10px';
      
      sectionHeader.appendChild(sectionDot);
      sectionHeader.appendChild(document.createTextNode(section.name));
      sectionContainer.appendChild(sectionHeader);
      
      // Create table with enhanced styling
      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      table.style.fontSize = '14px';
      table.style.backgroundColor = colors.white;
      
      // Table header
      const thead = document.createElement('thead');
      thead.style.backgroundColor = colors.light;
      thead.innerHTML = `
        <tr>
          <th style="padding: 15px 20px; text-align: right; border-bottom: 2px solid ${colors.secondary}; color: ${colors.primary}; font-weight: 700;">פריט</th>
          <th style="padding: 15px 20px; text-align: center; border-bottom: 2px solid ${colors.secondary}; color: ${colors.primary}; font-weight: 700;">כמות</th>
          <th style="padding: 15px 20px; text-align: center; border-bottom: 2px solid ${colors.secondary}; color: ${colors.primary}; font-weight: 700;">מחיר</th>
          <th style="padding: 15px 20px; text-align: center; border-bottom: 2px solid ${colors.secondary}; color: ${colors.primary}; font-weight: 700;">ימים</th>
          <th style="padding: 15px 20px; text-align: center; border-bottom: 2px solid ${colors.secondary}; color: ${colors.primary}; font-weight: 700;">סה"כ</th>
        </tr>
      `;
      table.appendChild(thead);
      
      // Table body with enhanced hover effect
      const tbody = document.createElement('tbody');
      section.items.forEach((item, i) => {
        const row = document.createElement('tr');
        row.style.backgroundColor = i % 2 === 0 ? colors.white : colors.light;
        row.style.transition = 'background-color 0.2s';
        
        // This won't actually hover in PDF, but adds a nice touch in preview
        row.onmouseover = () => { row.style.backgroundColor = 'rgba(62, 146, 204, 0.1)'; };
        row.onmouseout = () => { row.style.backgroundColor = i % 2 === 0 ? colors.white : colors.light; };
        
        row.innerHTML = `
          <td style="padding: 12px 20px; text-align: right; border-bottom: 1px solid #eee; font-weight: 500;">${item.name}</td>
          <td style="padding: 12px 20px; text-align: center; border-bottom: 1px solid #eee;">${item.quantity}</td>
          <td style="padding: 12px 20px; text-align: center; border-bottom: 1px solid #eee;">${quoteData.currencySymbol}${Number(item.unitPrice).toLocaleString()}</td>
          <td style="padding: 12px 20px; text-align: center; border-bottom: 1px solid #eee;">${item.days}</td>
          <td style="padding: 12px 20px; text-align: center; border-bottom: 1px solid #eee; font-weight: 700; color: ${colors.primary};">${quoteData.currencySymbol}${Number(item.total).toLocaleString()}</td>
        `;
        
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      
      // Calculate section total
      const sectionTotal = section.items.reduce((sum, item) => sum + Number(item.total), 0);
      
      // Table footer with enhanced styling
      const tfoot = document.createElement('tfoot');
      tfoot.style.backgroundColor = colors.light;
      tfoot.innerHTML = `
        <tr>
          <td colspan="4" style="padding: 15px 20px; text-align: left; font-weight: 700; border-top: 2px solid ${colors.primary}; color: ${colors.primary};">סה"כ ${section.name}</td>
          <td style="padding: 15px 20px; text-align: center; font-weight: 700; border-top: 2px solid ${colors.primary}; color: ${colors.primary};">${quoteData.currencySymbol}${sectionTotal.toLocaleString()}</td>
        </tr>
      `;
      table.appendChild(tfoot);
      
      sectionContainer.appendChild(table);
      itemsSection.appendChild(sectionContainer);
    }
  });
  
  // Totals section with enhanced gradient styling
  const totalsSection = document.createElement('div');
  totalsSection.style.background = `linear-gradient(135deg, ${colors.dark}, ${colors.primary})`;
  totalsSection.style.color = colors.white;
  totalsSection.style.padding = '20px';
  totalsSection.style.borderRadius = '8px';
  totalsSection.style.marginTop = '25px';
  totalsSection.style.boxShadow = '0 8px 15px rgba(0, 0, 0, 0.1)';
  totalsSection.style.position = 'relative';
  totalsSection.style.overflow = 'hidden';
  
  // Add subtle diagonal pattern for texture
  const pattern = document.createElement('div');
  pattern.style.position = 'absolute';
  pattern.style.top = '0';
  pattern.style.left = '0';
  pattern.style.right = '0';
  pattern.style.bottom = '0';
  pattern.style.background = 'repeating-linear-gradient(45deg, rgba(255,255,255,0.05), rgba(255,255,255,0.05) 10px, transparent 10px, transparent 20px)';
  pattern.style.zIndex = '0';
  totalsSection.appendChild(pattern);
  
  // Content wrapper to position above the pattern
  const totalsContent = document.createElement('div');
  totalsContent.style.position = 'relative';
  totalsContent.style.zIndex = '1';
  
  if (quoteData.totals.specialDiscount > 0) {
    const discountRow = document.createElement('div');
    discountRow.style.display = 'flex';
    discountRow.style.justifyContent = 'space-between';
    discountRow.style.marginBottom = '15px';
    discountRow.style.padding = '0 10px';
    discountRow.innerHTML = `
      <span>הנחה מיוחדת:</span>
      <span>${quoteData.currencySymbol}${quoteData.totals.specialDiscount.toLocaleString()}</span>
    `;
    totalsContent.appendChild(discountRow);
  }
  
  // Highlight for the total amount
  const totalHighlight = document.createElement('div');
  totalHighlight.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
  totalHighlight.style.borderRadius = '6px';
  totalHighlight.style.padding = '15px';
  totalHighlight.style.marginTop = '10px';
  
  const totalRow = document.createElement('div');
  totalRow.style.display = 'flex';
  totalRow.style.justifyContent = 'space-between';
  totalRow.style.fontWeight = 'bold';
  totalRow.style.fontSize = '20px';
  totalRow.style.letterSpacing = '0.5px';
  totalRow.innerHTML = `
    <span>סה"כ ללא מע"מ:</span>
    <span style="color: ${colors.highlight};">${quoteData.currencySymbol}${quoteData.totals.finalTotal.toLocaleString()}</span>
  `;
  totalHighlight.appendChild(totalRow);
  totalsContent.appendChild(totalHighlight);
  
  totalsSection.appendChild(totalsContent);
  itemsSection.appendChild(totalsSection);
  
  // Add main content sections to layout
  mainContent.appendChild(itemsSection);
  mainContent.appendChild(clientDetailsSection);
  contentContainer.appendChild(mainContent);
  
  // Footer with company details - more corporate styling
  const footer = document.createElement('div');
  footer.style.position = 'absolute';
  footer.style.bottom = '15mm';
  footer.style.left = '15mm';
  footer.style.right = '15mm';
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.alignItems = 'center';
  footer.style.padding = '15px 0';
  footer.style.borderTop = `1px solid ${colors.light}`;
  
  const footerLeft = document.createElement('div');
  footerLeft.style.textAlign = 'left';
  footerLeft.style.color = colors.textLight;
  footerLeft.style.fontSize = '12px';
  footerLeft.innerHTML = `
    <div style="margin-bottom: 5px;">${quoteData.paymentTerms || 'שוטף + 60'}</div>
  `;
  
  const footerCenter = document.createElement('div');
  footerCenter.style.textAlign = 'center';
  footerCenter.style.color = colors.primary;
  footerCenter.style.fontSize = '12px';
  footerCenter.style.fontWeight = '600';
  footerCenter.innerHTML = `
    <div style="margin-bottom: 5px;">הקול פתרונות א.ר בע״מ | ח.פ 514837236</div>
  `;
  
  const footerRight = document.createElement('div');
  footerRight.style.textAlign = 'right';
  footerRight.style.color = colors.textLight;
  footerRight.style.fontSize = '12px';
  footerRight.innerHTML = `
    <div style="margin-bottom: 5px;">office@hakolsound.co.il | www.hakolsound.co.il</div>
  `;
  
  footer.appendChild(footerLeft);
  footer.appendChild(footerCenter);
  footer.appendChild(footerRight);
  
  contentContainer.appendChild(footer);
  
  // Signature area with enhanced styling
  const signatureArea = document.createElement('div');
  signatureArea.style.display = 'flex';
  signatureArea.style.justifyContent = 'space-between';
  signatureArea.style.marginTop = '40px';
  
  const leftSignature = document.createElement('div');
  leftSignature.style.width = '40%';
  leftSignature.style.position = 'relative';
  leftSignature.innerHTML = `
    <div style="margin-bottom: 30px; font-weight: 600; color: ${colors.primary};">תאריך וחתימה:</div>
    <div style="width: 100%; border-top: 2px solid ${colors.secondary};"></div>
  `;
  
  const rightSignature = document.createElement('div');
  rightSignature.style.width = '40%';
  rightSignature.style.position = 'relative';
  rightSignature.innerHTML = `
    <div style="margin-bottom: 30px; font-weight: 600; color: ${colors.primary};">שם המאשר:</div>
    <div style="width: 100%; border-top: 2px solid ${colors.secondary};"></div>
  `;
  
  signatureArea.appendChild(rightSignature);
  signatureArea.appendChild(leftSignature);
  contentContainer.appendChild(signatureArea);
  
  printContainer.appendChild(contentContainer);
  
  // Add to document body temporarily
  document.body.appendChild(printContainer);
  
  return printContainer;
};