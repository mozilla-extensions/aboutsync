#!/bin/bash
# screw trying to make this generic - it's trivial enough!

#uncomment to debug
#set -x

APP_NAME=aboutsync
XPI=$APP_NAME.xpi
SOURCE_ZIP=${APP_NAME}-sources.zip
ZIP_CMD="zip -9 -q"

rm $XPI
$ZIP_CMD $XPI README.md chrome.manifest manifest.json ext_bootstrap.js webext/*

# It's called build-js since it doesn't exeucte this build script
npm run build-js

# The data directory non-recursively.
$ZIP_CMD $XPI data/*

# Report details about what we created.
find $XPI -maxdepth 1 -printf '%f, %s bytes'
echo

# AMO suddenly wants us to include a .zip file with the sources used to
# build it. A full zip, including node-modules, is too large.
[ -e $SOURCE_ZIP ] && rm $SOURCE_ZIP
$ZIP_CMD $SOURCE_ZIP * -x aboutsync*
$ZIP_CMD $SOURCE_ZIP -r data lib src webext
find $SOURCE_ZIP -maxdepth 1 -printf '%f, %s bytes'
echo

# Now try and sign it!
# See https://mana.mozilla.org/wiki/display/SVCOPS/Sign+a+Mozilla+Internal+Extension for the gory details,
# but you will need to have setup a number of environment variables and
# activated a virtualenv for this to work.
# XXX - need at least:
# AWS_ACCESS_KEY_ID, AWS_DEFAULT_REGION, AWS_SECRET_ACCESS_KEY, MOZENV

[ -e "aboutsync-signed.xpi" ] && rm aboutsync-signed.xpi
echo
echo Uploading XPI to sign...
sign-xpi -t mozillaextension -e $MOZENV -s net-mozaws-$MOZENV-addons-signxpi-input aboutsync.xpi
echo Downloading signed XPI...
aws s3 cp s3://net-mozaws-$MOZENV-addons-signxpi-output/aboutsync.xpi ./aboutsync-signed.xpi
