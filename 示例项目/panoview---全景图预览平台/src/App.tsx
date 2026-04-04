/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Pannellum } from 'pannellum-react';
import { Upload, Image as ImageIcon, X, Compass, Trash2, LayoutGrid, Maximize, Minimize } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useEffect } from 'react';
import { cn } from './lib/utils';
import { ModernLoader } from './components/ModernLoader';

interface PanoImage {
  id: string;
  url: string;
  name: string;
  timestamp: number;
  correction?: {
    roll: number;
    pitch: number;
  };
}

export default function App() {
  const [images, setImages] = useState<PanoImage[]>([]);
  const [currentImage, setCurrentImage] = useState<PanoImage | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        setError(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const loadSample = () => {
    const sample: PanoImage = {
      id: 'sample-1',
      url: 'https://pannellum.org/images/alma.jpg',
      name: 'Atacama Large Millimeter Array',
      timestamp: Date.now()
    };
    setImages(prev => [sample, ...prev.filter(img => img.id !== 'sample-1')]);
    setCurrentImage(sample);
    setError(null);
  };

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsLoading(true);
    setError(null);

    const newImages: PanoImage[] = [];
    const fileArray = Array.from(files);
    let processedCount = 0;

    fileArray.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const url = e.target?.result as string;
          const newImg: PanoImage = {
            id: Math.random().toString(36).substr(2, 9),
            url,
            name: file.name,
            timestamp: Date.now()
          };
          newImages.push(newImg);
          processedCount++;
          if (processedCount === fileArray.length) {
            setImages(prev => [...newImages, ...prev]);
            if (newImages.length > 0) {
              const firstNew = newImages[0];
              setCurrentImage(firstNew);
            }
            setIsLoading(false);
          }
        };
        reader.readAsDataURL(file);
      } else {
        processedCount++;
        if (processedCount === fileArray.length) setIsLoading(false);
      }
    });
  };

  const removeImage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setImages(prev => {
      const filtered = prev.filter(img => img.id !== id);
      if (currentImage?.id === id) {
        setCurrentImage(filtered.length > 0 ? filtered[0] : null);
      }
      return filtered;
    });
  };

  return (
    <div className="h-screen w-full relative overflow-hidden bg-black selection:bg-indigo-500/30">
      {/* Background Immersive Viewer */}
      <div className="absolute inset-0 z-0">
        {currentImage ? (
          <motion.div 
            key={currentImage.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.5 }}
            className="w-full h-full"
          >
            <Pannellum
              width="100%"
              height="100%"
              image={currentImage.url}
              pitch={10}
              yaw={180}
              hfov={110}
              autoLoad
              showZoomCtrl={false}
              onLoad={() => setIsLoading(false)}
            />
          </motion.div>
        ) : (
          <div 
            className={cn(
              "absolute inset-0 flex flex-col items-center justify-center p-8 transition-all duration-700",
              isDragging ? "bg-indigo-500/10" : "bg-[#050505]"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e.dataTransfer.files); }}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center max-w-lg"
            >
              <div className="w-24 h-24 bg-indigo-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-indigo-500/20 shadow-2xl shadow-indigo-500/10">
                <Compass className="w-12 h-12 text-indigo-400" />
              </div>
              <h1 className="text-6xl font-display font-bold text-white mb-6 tracking-tight">PanoView</h1>
              <p className="text-slate-400 text-lg mb-10 leading-relaxed font-light">
                Experience your panoramas in a new dimension. <br className="hidden sm:block" />
                Drag and drop your 360° images to begin.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-primary px-10 py-4 text-lg"
                >
                  <Upload className="w-5 h-5" />
                  Upload Image
                </button>
                <button
                  onClick={loadSample}
                  className="glass hover:bg-white/10 text-white px-10 py-4 rounded-full font-semibold transition-all active:scale-95 border border-white/10"
                >
                  Explore Sample
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>

      {/* Floating Header */}
      <header className="absolute top-0 left-0 right-0 z-40 p-6 flex items-center justify-between pointer-events-none">
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center gap-3 pointer-events-auto"
        >
          <div className="w-10 h-10 glass rounded-xl flex items-center justify-center">
            <Compass className="w-6 h-6 text-indigo-400" />
          </div>
          <span className="font-display font-bold text-xl tracking-tight text-white uppercase letter-spacing-[0.2em]">PanoView</span>
        </motion.div>

        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center gap-3 pointer-events-auto"
        >
          {currentImage && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="glass hover:bg-white/10 text-white p-3 rounded-full transition-all active:scale-95 border border-white/10"
              title="Upload New"
            >
              <Upload className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={toggleFullscreen}
            className="glass p-3 rounded-full transition-all active:scale-95 border border-white/10 text-white hover:bg-white/10"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
          <button
            onClick={() => setShowGallery(!showGallery)}
            className={cn(
              "glass p-3 rounded-full transition-all active:scale-95 border border-white/10",
              showGallery ? "bg-indigo-600 text-white border-indigo-500/30" : "text-white hover:bg-white/10"
            )}
            title="Toggle Gallery"
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
        </motion.div>
      </header>

      {/* Floating Controls (Bottom) */}
      <AnimatePresence>
        {currentImage && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute bottom-8 left-0 right-0 z-40 flex flex-col items-center gap-4 pointer-events-none px-6"
          >
            <div className="flex flex-col items-center gap-2">
              <div className="glass-dark px-6 py-2 rounded-2xl border border-white/5 pointer-events-auto text-center">
                <p className="text-white text-sm font-medium truncate max-w-[200px] sm:max-w-[400px]">
                  {currentImage.name}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Side Gallery Drawer */}
      <AnimatePresence>
        {showGallery && images.length > 0 && (
          <motion.aside 
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            className="absolute top-0 right-0 bottom-0 w-80 z-30 glass-dark border-l border-white/5 flex flex-col pt-24"
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h3 className="font-display font-bold text-white flex items-center gap-3 uppercase tracking-widest text-xs">
                <ImageIcon className="w-4 h-4 text-indigo-400" />
                Gallery
                <span className="bg-white/5 text-slate-400 text-[10px] px-2 py-0.5 rounded-full border border-white/5">
                  {images.length}
                </span>
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              {images.map((img) => (
                <motion.div
                  key={img.id}
                  layout
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => setCurrentImage(img)}
                  className={cn(
                    "group relative rounded-2xl overflow-hidden cursor-pointer border transition-all duration-300",
                    currentImage?.id === img.id 
                      ? "border-indigo-500 ring-4 ring-indigo-500/10" 
                      : "border-white/5 hover:border-white/20 bg-white/5"
                  )}
                >
                  <div className="aspect-[2/1] relative">
                    <img 
                      src={img.url} 
                      alt={img.name}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button 
                        onClick={(e) => removeImage(img.id, e)}
                        className="p-3 bg-red-500/90 hover:bg-red-600 text-white rounded-2xl transition-all shadow-xl"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="text-xs font-medium text-slate-300 truncate">
                      {img.name}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Global Loader */}
      <AnimatePresence>
        {isLoading && <ModernLoader />}
      </AnimatePresence>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 24, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="absolute top-0 left-0 right-0 z-[100] flex justify-center px-6"
          >
            <div className="bg-red-500 text-white px-6 py-3 rounded-2xl text-sm font-bold flex items-center gap-3 shadow-2xl shadow-red-500/20 border border-red-400/30 backdrop-blur-xl">
              <X className="w-5 h-5" />
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-4 hover:opacity-70">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
      />
    </div>
  );
}
