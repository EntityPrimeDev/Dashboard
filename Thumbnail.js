const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

function createThumbnail(videoPath, videoId, timestamp) {
  const thumbnailPath = path.join('Data/Thumbnails', `${videoId}.png`);

  ffmpeg(videoPath)
    .screenshots({
      timestamps: [timestamp],
      filename: `${videoId}.png`,
      folder: 'Data/Thumbnails',
    })
    .on('end', () => {
      console.log(`Thumbnail created for video ${videoId} at timestamp ${timestamp} seconds`);
    })
    .on('error', (err) => {
      console.error(`Error creating thumbnail: ${err}`);
    });
}

module.exports = { createThumbnail };
