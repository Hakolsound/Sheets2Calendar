// server.js - Express server for PDF generation
const express = require('express');
const cors = require('cors');
const { renderToStream } = require('@react-pdf/renderer');
const { Storage } = require('@google-cloud/storage');
const admin = require('firebase-admin');
const React = require('react');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

// Initialize Google Cloud Storage
const storage = new Storage();
const bucketName = 'your-quote-pdfs-bucket';

// Import our React PDF component
const QuoteDocument = require('./QuoteDocument').default;

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Route for generating PDFs
app.post('/api/generate-pdf', async (req, res) => {
  try {
    const { quoteId } = req.body;
    
    if (!quoteId) {
      return res.status(400).json({ error: 'Quote ID is required' });
    }
    
    // Get the quote data from Firestore
    const quoteDoc = await admin.firestore().collection('quotes').doc(quoteId).get();
    
    if (!quoteDoc.exists) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    const quoteData = quoteDoc.data();
    
    // Create the PDF document using React
    const MyDocument = React.createElement(QuoteDocument, { quoteData });
    
    // Generate a filename for the PDF
    const filename = `quote_${quoteId}_${Date.now()}.pdf`;
    
    // Create a write stream to Google Cloud Storage
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filename);
    const writeStream = file.createWriteStream({
      metadata: {
        contentType: 'application/pdf',
      },
    });
    
    // Handle stream errors
    writeStream.on('error', (err) => {
      console.error('Error uploading PDF:', err);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    });
    
    // On success, make the file public and return the URL
    writeStream.on('finish', async () => {
      // Make the file publicly accessible
      await file.makePublic();
      
      // Get the public URL
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${filename}`;
      
      // Update the quote document with the PDF URL
      await admin.firestore().collection('quotes').doc(quoteId).update({
        pdfUrl: publicUrl,
        generatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Return the URL to the client
      return res.status(200).json({ 
        success: true, 
        pdfUrl: publicUrl 
      });
    });
    
    // Render the PDF to the write stream
    renderToStream(MyDocument).pipe(writeStream);
    
  } catch (error) {
    console.error('PDF generation error:', error);
    return res.status(500).json({ 
      error: 'PDF generation failed', 
      message: error.message 
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PDF generation service running on port ${PORT}`);
});