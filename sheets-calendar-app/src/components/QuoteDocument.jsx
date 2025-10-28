import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer';

// Register Hebrew fonts
Font.register({
  family: 'Hebrew',
  src: '/fonts/OpenSansHebrew-Regular.ttf',
  fontWeight: 'normal',
});

Font.register({
  family: 'Hebrew',
  src: '/fonts/OpenSansHebrew-Bold.ttf',
  fontWeight: 'bold',
});

// Create styles for the PDF
const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#fff',
    padding: 30,
    fontFamily: 'Hebrew',
    fontSize: 10,
  },
  rtl: {
    direction: 'rtl',
    textAlign: 'right',
  },
  header: {
    flexDirection: 'row',
    marginBottom: 20,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 48,
  },
  headerRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  quoteTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 5,
  },
  quoteSubtitle: {
    fontSize: 14,
    color: '#34495e',
  },
  clientInfo: {
    marginTop: 20,
    marginBottom: 10,
    padding: 10,
    backgroundColor: '#f8f9fa',
    borderRadius: 5,
  },
  sectionHeader: {
    marginTop: 15,
    padding: 8,
    backgroundColor: '#2c3e50',
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
    borderRadius: 3,
  },
  venueHeader: {
    marginTop: 20,
    marginBottom: 10,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2c3e50',
    borderBottom: 1,
    borderBottomColor: '#bdc3c7',
    paddingBottom: 5,
  },
  venueDetails: {
    color: '#7f8c8d',
    marginBottom: 5,
  },
  table: {
    display: 'flex',
    width: 'auto',
    marginVertical: 5,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 3,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#f5f5f5',
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tableRowEven: {
    backgroundColor: '#f9f9f9',
  },
  tableRowOdd: {
    backgroundColor: '#ffffff',
  },
  tableCol: {
    padding: 5,
    textAlign: 'right',
  },
  tableColQuantity: {
    width: '10%',
    textAlign: 'center',
  },
  tableColItem: {
    width: '40%',
  },
  tableColPrice: {
    width: '20%',
    textAlign: 'center',
  },
  tableColDays: {
    width: '10%',
    textAlign: 'center',
  },
  tableColTotal: {
    width: '20%',
    textAlign: 'center',
  },
  sectionTotal: {
    marginTop: 5,
    marginBottom: 15,
    padding: 5,
    textAlign: 'left',
    fontWeight: 'bold',
    fontSize: 12,
  },
  summarySection: {
    marginTop: 20,
    padding: 10,
    backgroundColor: '#f8f9fa',
    borderRadius: 5,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  summaryLabel: {
    fontWeight: 'bold',
  },
  grandTotal: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#2c3e50',
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
    borderRadius: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  termsSection: {
    marginTop: 30,
    padding: 10,
    borderTop: 1,
    borderTopColor: '#e0e0e0',
  },
  termsTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
    fontSize: 12,
  },
  termsText: {
    color: '#7f8c8d',
    marginBottom: 3,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    textAlign: 'center',
    color: '#7f8c8d',
    fontSize: 8,
    borderTop: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 10,
  },
  signatureSection: {
    marginTop: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  signatureBox: {
    width: '45%',
    borderTop: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 5,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 15,
    right: 30,
    fontSize: 8,
    color: '#7f8c8d',
  },
});

// Component for rendering a section of items
const ItemsSection = ({ section, currencySymbol, index }) => {
  const calculateSectionTotal = () => {
    return section.items.reduce((sum, item) => sum + Number(item.total), 0);
  };

  return (
    <View style={styles.rtl}>
      <Text style={styles.sectionHeader}>{section.name}</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableCol, styles.tableColTotal]}>סה״כ</Text>
          <Text style={[styles.tableCol, styles.tableColDays]}>ימים</Text>
          <Text style={[styles.tableCol, styles.tableColPrice]}>מחיר</Text>
          <Text style={[styles.tableCol, styles.tableColQuantity]}>כמות</Text>
          <Text style={[styles.tableCol, styles.tableColItem]}>פריט</Text>
        </View>
        
        {section.items.map((item, i) => (
          <View 
            key={`${index}-${i}`} 
            style={[
              styles.tableRow, 
              i % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd
            ]}
          >
            <Text style={[styles.tableCol, styles.tableColTotal]}>
              {currencySymbol}{Number(item.total).toLocaleString()}
            </Text>
            <Text style={[styles.tableCol, styles.tableColDays]}>
              {item.days}
            </Text>
            <Text style={[styles.tableCol, styles.tableColPrice]}>
              {currencySymbol}{Number(item.unitPrice).toLocaleString()}
            </Text>
            <Text style={[styles.tableCol, styles.tableColQuantity]}>
              {item.quantity}
            </Text>
            <Text style={[styles.tableCol, styles.tableColItem]}>
              {item.name}
            </Text>
          </View>
        ))}
      </View>
      
      <View style={styles.sectionTotal}>
        <Text>
          סה״כ {section.name}: {currencySymbol}{calculateSectionTotal().toLocaleString()}
        </Text>
      </View>
    </View>
  );
};

// Venue section component
const VenueSection = ({ venue }) => (
  <View style={styles.rtl}>
    <Text style={styles.venueHeader}>{venue.name}</Text>
    {venue.description && (
      <Text style={styles.venueDetails}>{venue.description}</Text>
    )}
  </View>
);

// Main Quote PDF Component
const QuoteDocument = ({ quoteData }) => {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header with Logo */}
        <View style={styles.header}>
          <Image src="/logo512.png" style={styles.logo} />
          <View style={[styles.headerRight, styles.rtl]}>
            <Text style={styles.quoteTitle}>הצעת מחיר לשירותים טכניים מוקפדים</Text>
            <Text style={styles.quoteSubtitle}>
              {quoteData.eventInfo.name} - {quoteData.eventInfo.location} - {quoteData.eventInfo.date}
            </Text>
          </View>
        </View>
        
        {/* Client Information */}
        <View style={[styles.clientInfo, styles.rtl]}>
          <Text>לכבוד: {quoteData.clientInfo.name}</Text>
          <Text>חברה: {quoteData.clientInfo.companyName}</Text>
          <Text>מייל: {quoteData.clientInfo.email}</Text>
          {quoteData.clientInfo.phone && <Text>טלפון: {quoteData.clientInfo.phone}</Text>}
          {quoteData.producerInfo?.name && <Text>מפיק/ה: {quoteData.producerInfo.name}</Text>}
        </View>
        
        {/* Render each section */}
        {quoteData.sections.map((section, index) => (
          <React.Fragment key={index}>
            {section.type === 'venue' ? (
              <VenueSection venue={section} />
            ) : (
              <ItemsSection 
                section={section} 
                currencySymbol={quoteData.currencySymbol} 
                index={index} 
              />
            )}
          </React.Fragment>
        ))}
        
        {/* Summary and Totals */}
        <View style={[styles.summarySection, styles.rtl]}>
          {quoteData.totals.specialDiscount > 0 && (
            <View style={styles.summaryRow}>
              <Text>{quoteData.currencySymbol}{quoteData.totals.specialDiscount.toLocaleString()}</Text>
              <Text style={styles.summaryLabel}>הנחה מיוחדת:</Text>
            </View>
          )}
          
          <View style={styles.grandTotal}>
            <Text>{quoteData.currencySymbol}{quoteData.totals.finalTotal.toLocaleString()}</Text>
            <Text>סה״כ ללא מע״מ:</Text>
          </View>
        </View>
        
        {/* Payment Terms */}
        <View style={[styles.termsSection, styles.rtl]}>
          <Text style={styles.termsTitle}>תנאי תשלום</Text>
          <Text style={styles.termsText}>{quoteData.paymentTerms || 'שוטף + 30'}</Text>
          <Text style={styles.termsText}>
            העברה בנקאית לא יאוחר מ-30 יום לאחר האירוע
          </Text>
          <Text style={styles.termsText}>
            בירורים בנושא חשבוניות: msn@hakolsound.co.il | 052-5757377
          </Text>
        </View>
        
        {/* Signature Section */}
        <View style={[styles.signatureSection, styles.rtl]}>
          <View style={styles.signatureBox}>
            <Text>תאריך וחתימה</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text>שם המאשר</Text>
          </View>
        </View>
        
        {/* Footer */}
        <View style={styles.footer}>
          <Text>
            הקול פתרונות א.ר בע״מ | ח.פ 514837236 | office@hakolsound.co.il | www.hakolsound.co.il
          </Text>
        </View>
        
        {/* Page Number */}
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => (
          `${pageNumber} / ${totalPages}`
        )} />
      </Page>
    </Document>
  );
};

export default QuoteDocument;