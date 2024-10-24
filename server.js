const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = 3000;

app.use(cors());

// YouTube Search API
app.get('/search', async (req, res) => {
  try {
    const query = req.query.query;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchURL = `https://www.x-noobs-apis.000.pe/nazrul/ytSearch?search=${encodeURIComponent(query)}`;
    const response = await axios.get(searchURL);

    if (response.data && response.data.results) {
      res.json({
        results: response.data.results,
      });
    } else {
      res.status(404).json({ error: 'No videos found for your query' });
    }

  } catch (error) {
    console.error('Error fetching search results:', error);
    res.status(500).json({ error: 'Error fetching search results' });
  }
});

// YouTube Download API
app.get('/get', async (req, res) => {
  try {
    const videoURL = req.query.url;

    if (!videoURL) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    const downloadURL = `https://www.x-noobs-apis.000.pe/nazrul/ytdl?url=${encodeURIComponent(videoURL)}`;
    const response = await axios({
      method: 'get',
      url: downloadURL,
      responseType: 'stream'
    });

    res.set('Content-Disposition', 'attachment; filename="video.mp4"');
    res.set('Content-Type', 'video/mp4');
    response.data.pipe(res);

  } catch (error) {
    console.error('Error downloading video:', error);
    res.status(500).json({ error: 'Error downloading video' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
