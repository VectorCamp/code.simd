# code.simd README

Supercharge SIMD development directly in your IDE.

Syntax Highlighting Intel SSE4.2, AVX2, AVX512,Arm NEON,Power VSX,Power IBM-Z and more—right inside your editor. Smart intrinsics highlighting, autocomplete suggestions, and seamless dev workflow integration.

## Example 1 – VSX
![VSX Example](media/power_vsx_example.png)

## Example 2 – NEON
![NEON Example](media/arm_neon_example.png)

## Example 3 – SSE
![SSE Example](media/intel_sse_example.png)


## Features
- **Smart Intrinsics Highlighting**  
  Easily read and navigate SIMD intrinsics with syntax highlighting tailored to each architecture.

<video id="demo-video" class="demo-video" autoplay="" muted="" loop="" playsinline="" preload="auto" disablepictureinpicture="" controlslist="nodownload nofullscreen noremoteplayback" src="https://code.simd.ai/images/vids/highlighting_2.mp4">
    <source src="https://code.simd.ai/images/videos/chatting_trimmed_final.mp4" type="video/mp4">
    Your browser does not support the video tag.
</video>


- **Standard Architectures**  
  - Standard (requires SIMD.ai paid plan): Intel SSE4.2, AVX2, AVX512,Arm NEON,Power VSX,Power IBM-Z 
  
---

## Requirements

- Visual Studio Code (latest stable version recommended)
- SIMD.ai account for premium architectures

---

## Extension Settings

This extension contributes the following settings:

* `code.simd.ai.apiToken`: Your SIMD AI API token. Get it from [https://simd.ai/](https://simd.ai/).

---

## Known issues
- Users may need to reload VS Code after setting the token to enable syntax highlighting.

We are actively working to address this issue in an upcoming release.

---

## Coming soon
- Some architectures (e.g. RVV 1.0,LOONGSON LSX/LASX, MIPS/MSA,Intel AMX, ARM SME2, ARM SVE/SVE2  ) are still in development.  

---

## Support email
- Contact us at code.simd.ai@vectorcamp.gr


**Enjoy SIMD coding made easy!**
