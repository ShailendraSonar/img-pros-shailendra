const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const sharp = require('sharp');
const mongoose = require('mongoose');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;

// MongoDB connection
mongoose.connect('mongodb+srv://shailen112001:DFpk2IzqvldPUzuV@cluster0.xhdzr.mongodb.net/?retryWrites=true&w=majority')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mongoose Schema
const requestSchema = new mongoose.Schema({
  requestId: String,
  status: { type: String, default: 'pending' },
  data: Array,
  outputUrls: Array,
  createdAt: { type: Date, default: Date.now }
});

const Request = mongoose.model('Request', requestSchema);

// Configure multer
const upload = multer({ dest: 'uploads/' });

// Directory for output images
const outputDir = 'output_images/';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

app.use(express.json());

// Helper function to validate URLs
const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
};

// Upload API
app.post('/upload', upload.single('csv'), async (req, res) => {
  const requestId = uuidv4();
  const filePath = req.file.path;

  const results = [];
  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      const request = new Request({ requestId, data: results });
      await request.save();
      processImages(requestId, results);
      res.json({ requestId });
    })
    .on('error', (error) => {
      console.error('Error reading CSV file:', error);
      res.status(500).send('Error reading CSV file');
    });
});

// Status API
app.get('/status/:requestId', async (req, res) => {
  const { requestId } = req.params;
  try {
    const request = await Request.findOne({ requestId });
    if (request) {
      res.json(request);
    } else {
      res.status(404).send('Request not found');
    }
  } catch (error) {
    console.error('Error fetching request status:', error);
    res.status(500).send('Error fetching request status');
  }
});

// Process Images
const processImages = async (requestId, data) => {
    const request = await Request.findOne({ requestId });
    if (!request) return;
  
    request.status = 'processing';
    await request.save();
  
    for (const row of data) {
      const inputUrls = row['Input Image Urls'].split(',').map(url => url.trim());
      const outputUrls = [];
  
      for (const url of inputUrls) {
        if (!isValidUrl(url)) {
          console.error(`Invalid URL: ${url}`);
          continue;
        }
  
        try {
          console.log(`Processing image from URL: ${url}`);
          const image = await axios.get(url, { responseType: 'arraybuffer' });
          const outputFileName = `${uuidv4()}.jpg`;
          const outputPath = `${outputDir}${outputFileName}`;
  
          // Get image metadata to determine dimensions
          const metadata = await sharp(image.data).metadata();
          await sharp(image.data)
            .resize({ width: Math.round(metadata.width * 0.5) })
            .toFile(outputPath);
  
          // Assuming your server serves files from `output_images` directory
          const outputUrl = `http://localhost:${port}/output_images/${outputFileName}`;
          outputUrls.push(outputUrl);
        } catch (error) {
          console.error(`Error processing image from URL ${url}:`, error.message);
        }
      }
  
      row['Output Image Urls'] = outputUrls.join(',');
    }
  
    request.outputUrls = data.map(row => row['Output Image Urls']);
    request.status = 'completed';
    await request.save();
  };
  


// Serve output images
app.use('/output_images', express.static(outputDir));

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
