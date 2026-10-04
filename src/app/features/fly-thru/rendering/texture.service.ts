/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { Injectable } from '@angular/core';
import { GlService } from './gl.service';
import { ImageService } from '../../../shared/core/image.service';
import { Utility } from '../../../shared/classes/utility';
import { Colors } from '../../../shared/classes/graphics';

// Using types to ensure texture lookups are valid.
const TEXTURE_INFO = {
  'img/bricktile.png': Colors.GL_CONCRETE,
  'img/water.jpg': Colors.GL_WATER,
  'img/signlogo.png': Colors.GL_METAL,
} as const;
export type TextureUrl = keyof typeof TEXTURE_INFO;
type TextureMapUrl = TextureUrl | 'skybox';

const SKYBOX_TEXTURE_INFO = {
  'img/skye.jpg': WebGL2RenderingContext.TEXTURE_CUBE_MAP_POSITIVE_X,
  'img/skyw.jpg': WebGL2RenderingContext.TEXTURE_CUBE_MAP_NEGATIVE_X,
  'img/skyup.jpg': WebGL2RenderingContext.TEXTURE_CUBE_MAP_POSITIVE_Y,
  'img/skydn.jpg': WebGL2RenderingContext.TEXTURE_CUBE_MAP_NEGATIVE_Y,
  'img/skyn.jpg': WebGL2RenderingContext.TEXTURE_CUBE_MAP_POSITIVE_Z,
  'img/skys.jpg': WebGL2RenderingContext.TEXTURE_CUBE_MAP_NEGATIVE_Z,
} as const;

/** Gets entries of object preserving specific key and value types. */
function typedObjectEntries<T extends Object>(obj: T): [keyof T, T[keyof T]][] {
  return Object.entries(obj) as [keyof T, T[keyof T]][];
}

/**
 * Container for async texture creation logic. This is purpose-built. E.g.
 * there's no deleting textures or loading more than one skybox.
 */
@Injectable({ providedIn: 'root' })
export class TextureService {
  private readonly textures = new Map<TextureMapUrl, WebGLTexture>();

  constructor(
    private readonly glService: GlService,
    private readonly imageService: ImageService,
  ) {}

  /**
   * Loads all registered textures. Best do this early in the app lifecycle so
   * textures are ready when needed. Must be after `GlService` is initialized.
   */
  public loadAllTextures(): void {
    if (this.textures.size === 0) {
      this.loadTextures(typedObjectEntries(TEXTURE_INFO));
      this.loadSkyboxTextures(SKYBOX_TEXTURE_INFO);
    }
  }

  /** Returns the texture with given url. */
  public getTexture(url: TextureMapUrl): WebGLTexture {
    this.loadAllTextures();
    return this.textures.get(url)!;
  }

  /**
   * Loads the given textures into the owned map. Until the images are loaded, a 1-pixel image is used.
   * When multiple url/color pairs are given, none are upgraded to images until all have loaded.
   */
  private loadTextures(urlPreloadColorPairs: [TextureUrl, Uint8Array][]): void {
    // Start downloading the images with action to replace placeholders when all present.
    this.imageService
      .createImagesLoader(urlPreloadColorPairs.map(([url]) => url))
      .invokeAfterLoaded((images: { [url: string]: HTMLImageElement }) => {
        const gl = this.glService.gl;
        for (const [url, image] of Object.entries(images)) {
          const texture = Utility.assertNotUndefined(this.textures.get(url as TextureUrl));
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.generateMipmap(gl.TEXTURE_2D);
        }
      });
    // Build textures with initial 1-pixel placeholder images.
    for (const [url, preloadColor] of urlPreloadColorPairs) {
      const gl = this.glService.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, preloadColor);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.textures.set(url, texture);
    }
  }

  private loadSkyboxTextures(textureSidesByUrl: { [key: string]: number }): void {
    const gl = this.glService.gl;
    const texture = Utility.assertNotNull(gl.createTexture());
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    // Initially use null textures. Replace with images asynchronously. Using a color would require an image
    // with the full size of the real ones. Not worth it since loading will precede drawing in practice.
    for (const target of Object.values(textureSidesByUrl)) {
      gl.texImage2D(target, 0, gl.RGBA, 1024, 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    this.imageService.createImagesLoader(Object.keys(textureSidesByUrl)).invokeAfterLoaded(imagesByUrl => {
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
      for (const [url, image] of Object.entries(imagesByUrl)) {
        gl.texImage2D(textureSidesByUrl[url], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      }
    });
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set('skybox', texture);
  }
}
