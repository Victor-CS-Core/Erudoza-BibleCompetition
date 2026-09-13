"""Source-specific matte cleanup for the approved extracted character artwork."""
import numpy as np
from PIL import Image, ImageFilter


def clean_edges(image, inset=.5):
    rgba = np.array(image.convert('RGBA')).astype(float)
    alpha = image.getchannel('A')
    # Sample colors from inside the silhouette, never its cyan/checkerboard fringe.
    trusted = np.array(alpha.filter(ImageFilter.MinFilter(5))) >= 250
    weights = np.array(Image.fromarray(np.uint8(trusted)*255).filter(ImageFilter.BoxBlur(3))).astype(float)/255
    edge = (~trusted) & (rgba[:, :, 3] > 0) & (weights > .01)
    for channel in range(3):
        sums = np.array(Image.fromarray(np.uint8(rgba[:, :, channel]*trusted)).filter(ImageFilter.BoxBlur(3))).astype(float)
        rgba[:, :, channel][edge] = (sums/np.maximum(weights, .001))[edge]
    # A fractional inset suppresses the remaining outer matte without a hard cut.
    rgba[:, :, 3] = np.array(Image.blend(alpha, alpha.filter(ImageFilter.MinFilter(3)), inset))
    rgba = np.clip(rgba, 0, 255).astype('uint8')
    rgba[rgba[:, :, 3] == 0, :3] = 0
    return Image.fromarray(rgba)
