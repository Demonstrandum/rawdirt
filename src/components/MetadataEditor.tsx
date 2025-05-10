'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Chip,
  Button,
  Typography,
  Rating,
  Divider,
  Paper
} from '@mui/material';
import { RawFile, RawFileMetadata } from '@/types';
import useStore from '@/store/useStore';

interface MetadataEditorProps {
  file: RawFile;
}

const MetadataEditor = ({ file }: MetadataEditorProps) => {
  const { metadataMap, updateMetadata } = useStore();
  const metadata = metadataMap[file.key] || {
    id: file.key,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const [title, setTitle] = useState(metadata.title || '');
  const [description, setDescription] = useState(metadata.description || '');
  const [newTag, setNewTag] = useState('');
  const [locationName, setLocationName] = useState(metadata.location?.locationName || '');
  const [rating, setRating] = useState(metadata.rating || 0);

  // Update local state when metadata changes
  useEffect(() => {
    setTitle(metadata.title || '');
    setDescription(metadata.description || '');
    setLocationName(metadata.location?.locationName || '');
    setRating(metadata.rating || 0);
  }, [metadata]);

  const handleAddTag = () => {
    if (!newTag.trim()) return;

    const updatedTags = [...metadata.tags, newTag.trim()];
    updateMetadata(file.key, { tags: updatedTags });
    setNewTag('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const updatedTags = metadata.tags.filter(tag => tag !== tagToRemove);
    updateMetadata(file.key, { tags: updatedTags });
  };

  const handleSaveMetadata = () => {
    updateMetadata(file.key, {
      title,
      description,
      location: {
        ...(metadata.location || {}),
        locationName
      },
      rating
    });
  };

  return (
    <Paper sx={{ p: 2, height: '100%', overflowY: 'auto' }}>
      <Typography variant="h6" gutterBottom>
        Metadata
      </Typography>

      <Box sx={{ mb: 3 }}>
        <TextField
          label="Title"
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          margin="normal"
          size="small"
        />

        <TextField
          label="Description"
          fullWidth
          multiline
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          margin="normal"
          size="small"
        />

        <TextField
          label="Location"
          fullWidth
          value={locationName}
          onChange={(e) => setLocationName(e.target.value)}
          margin="normal"
          size="small"
        />

        <Box sx={{ mt: 2 }}>
          <Typography component="legend">Rating</Typography>
          <Rating
            name="rating"
            value={rating}
            onChange={(_, newValue) => {
              setRating(newValue || 0);
            }}
          />
        </Box>
      </Box>

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle1" gutterBottom>
        Tags
      </Typography>

      <Box sx={{ display: 'flex', mb: 1 }}>
        <TextField
          label="Add Tag"
          size="small"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              handleAddTag();
              e.preventDefault();
            }
          }}
          sx={{ flex: 1 }}
        />
        <Button
          variant="contained"
          onClick={handleAddTag}
          sx={{ ml: 1 }}
        >
          Add
        </Button>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
        {metadata.tags.map((tag) => (
          <Chip
            key={tag}
            label={tag}
            onDelete={() => handleRemoveTag(tag)}
          />
        ))}
        {metadata.tags.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No tags yet
          </Typography>
        )}
      </Box>

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSaveMetadata}
        >
          Save Changes
        </Button>
      </Box>
    </Paper>
  );
};

export default MetadataEditor;
