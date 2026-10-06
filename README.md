
<img src="https://raw.githubusercontent.com/rse/vingester/master/vingester-icon.png" width="150" align="right" alt=""/>

[Vingester](https://vingester.app)
==================================

**Ingest Web Contents as Video Streams**

Run web pages as video sources for Resolume, OBS Studio, and other NDI receivers.
This fork provides updated Windows builds of [Vingester](https://github.com/rse/vingester).

Get started on Windows
----------------------

1. Download the Windows executable from [Releases](https://github.com/steveseguin/vingester/releases/latest) and run it. Windows 10 or later, 64-bit, is required.
2. Add a browser, give it a unique title, and paste your page's URL into **Input URL**.
3. Enable **Headless** and **NDI**, choose the resolution, frame rate, and audio channels, then start the browser.
4. Select its title as the NDI source in your receiving application. Add another browser for each additional feed.

For YouTube, use the video's normal watch link, including the full link for an unlisted stream.
For a player-only view, use `https://www.youtube.com/embed/VIDEO_ID?autoplay=1`; if the uploader disables embedding, use the watch link.
For VDO.Ninja, use the viewing link for each feed.
Get updates for this fork from the Releases page; the built-in updater uses the upstream releases.

About
-----

**Vingester** (**V**ideo **ingester**) is a small
[Electron](https://www.electronjs.org/)-based desktop application
for use under Windows, macOS or Linux to run multiple
[Chromium](https://www.chromium.org/)-based Web browser instances and
ingesting their rendered Web Contents as screen/window-captured or
[NDI](https://www.ndi.tv/)-multicasted or [FFmpeg](https://ffmpeg.org)-based
video streams for further use in local or remote video mixing applications or
for local recording.

Sneak Preview
-------------

![Vingester Screenshot](vingester-screenshot.png)

Documentation
-------------

See the [Vingester Guide](https://vingester.app/guide/) for detailed
documentation on **Vingester**.

Copyright & License
-------------------

Copyright &copy; 2021-2022 [Dr. Ralf S. Engelschall](mailto:rse@engelschall.com)<br/>
Licensed under [GPL 3.0](https://spdx.org/licenses/GPL-3.0-only)
