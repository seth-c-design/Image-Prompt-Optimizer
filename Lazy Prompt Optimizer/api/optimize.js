// Seth Coulter | July 22 2025 (API Endpoint)

import { GoogleGenerativeAI } from '@google/generative-ai';
import formidable from 'formidable';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';

/**
 * Helper function to fetch an image from a URL and convert it to a GoogleGenerativeAI.Part object.
 * @param {string} url The URL of the image to fetch.
 * @param {string} mimeType The MIME type of the image.
 * @returns {Promise<object>} A promise that resolves to a Part object for the Generative AI API.
 */
async function urlToGenerativePart(url, mimeType) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
  }
  // 1. Download the image data into a buffer
  const buffer = await response.arrayBuffer();
  // 2. Convert the buffer to a base64 string
  const base64Data = Buffer.from(buffer).toString("base64");
  // 3. Return the data in the format Google's API expects
  return {
    inlineData: {
      data: base64Data,
      mimeType,
    },
  };
}


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse FormData
  const form = formidable({ multiples: false });
  const [fields, files] = await new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      resolve([fields, files]);
    });
  });

  const userPrompt = fields.userPrompt?.[0] || '';
  const imageUrl = fields.imageUrl?.[0] || '';
  let imagePart = null;

  if (!userPrompt.trim()) {
    return res.status(400).json({ error: 'Prompt cannot be empty.' });
  }

  try {
    // Handle image: File or URL
    if (files.image?.[0]) {
      const file = files.image[0];
      const buffer = await fs.readFile(file.filepath);
      imagePart = {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType: file.mimetype || 'image/jpeg'
        }
      };
      await fs.unlink(file.filepath); // Clean up temp file
    } else if (imageUrl) {
      
      imagePart = await urlToGenerativePart(imageUrl, 'image/png');
    }

    // Build prompt
    let fullPrompt = `
      You are an expert Midjourney prompt engineer. Your task is to take a user's simple idea and expand it into a detailed, structured prompt. The output must be a single line following this exact format:
      <Foreground: [detailed description]> <Midground: [detailed description]> <Background: [detailed description]> | <Style: [detailed description]>

      User's Idea: "${userPrompt}"`;

    if (imagePart) {
      fullPrompt = `
        Analyze the provided image and incorporate its elements and style into a final, single, structured prompt based on the user's idea.
        
        User's Idea: "${userPrompt}"
        
        Optimized Prompt:`;
    } else {
      fullPrompt += '\nOptimized Prompt:';
    }

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const content = [{ text: fullPrompt }];
    if (imagePart) {
      content.push(imagePart); // Add image to content array
    }

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: content }],
      generationConfig: {
        temperature: 1,
        maxOutputTokens: 1024,
        topP: 1
      }
    });

    const optimizedText = result.response.text().trim();
    res.status(200).json({ optimizedText });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: `An internal server error occurred: ${error.message}` });
  }
}
