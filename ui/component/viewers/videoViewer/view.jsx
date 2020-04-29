// @flow
import React, { useEffect, useState, useContext, useCallback } from 'react';
import { stopContextMenu } from 'util/context-menu';
import type { Player } from './internal/videojs';
import VideoJs from './internal/videojs';

import analytics from 'analytics';
import { EmbedContext } from 'page/embedWrapper/view';
import classnames from 'classnames';
import { FORCE_CONTENT_TYPE_PLAYER } from 'constants/claim';
import AutoplayCountdown from 'component/autoplayCountdown';
import usePrevious from 'effects/use-previous';
import FileViewerEmbeddedEnded from 'lbrytv/component/fileViewerEmbeddedEnded';
import FileViewerEmbeddedTitle from 'component/fileViewerEmbeddedTitle';
import LoadingScreen from 'component/common/loading-screen';

const PLAY_TIMEOUT_ERROR = 'play_timeout_error';

type Props = {
  position: number,
  changeVolume: number => void,
  changeMute: boolean => void,
  source: string,
  contentType: string,
  thumbnail: string,
  claim: Claim,
  muted: boolean,
  volume: number,
  uri: string,
  autoplaySetting: boolean,
  autoplayIfEmbedded: boolean,
  doAnalyticsView: (string, number) => Promise<any>,
  claimRewards: () => void,
};

/*
codesandbox of idealized/clean videojs and react 16+
https://codesandbox.io/s/71z2lm4ko6
 */

function VideoViewer(props: Props) {
  const {
    contentType,
    source,
    changeVolume,
    changeMute,
    thumbnail,
    position,
    claim,
    uri,
    muted,
    volume,
    autoplaySetting,
    autoplayIfEmbedded,
    doAnalyticsView,
    claimRewards,
  } = props;
  const claimId = claim && claim.claim_id;
  const isAudio = contentType.includes('audio');
  const forcePlayer = FORCE_CONTENT_TYPE_PLAYER.includes(contentType);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showAutoplayCountdown, setShowAutoplayCountdown] = useState(false);
  const [isEndededEmbed, setIsEndededEmbed] = useState(false);

  /* isLoading was designed to show loading screen on first play press, rather than completely black screen, but
  breaks because some browsers (e.g. Firefox) block autoplay but leave the player.play Promise pending */
  const [isLoading, setIsLoading] = useState(false);

  const previousUri = usePrevious(uri);
  const embedded = useContext(EmbedContext);

  // force everything to recent when URI changes, can cause weird corner cases otherwise (e.g. navigate while autoplay is true)
  useEffect(() => {
    if (uri && previousUri && uri !== previousUri) {
      setShowAutoplayCountdown(false);
      setIsEndededEmbed(false);
      setIsLoading(false);
    }
  }, [uri, previousUri]);

  function doTrackingBuffered(e: Event, data: any) {
    analytics.videoBufferEvent(claimId, data.currentTime);
  }

  function doTrackingFirstPlay(e: Event, data: any) {
    analytics.videoStartEvent(claimId, data.secondsToLoad);
    doAnalyticsView(uri, data.secondsToLoad).then(() => {
      claimRewards();
    });
  }

  function onEnded() {
    if (embedded) {
      setIsEndededEmbed(true);
    } else if (autoplaySetting) {
      setShowAutoplayCountdown(true);
    }
  }

  function onPlay() {
    setIsLoading(false);
    setIsPlaying(true);
    setShowAutoplayCountdown(false);
    setIsEndededEmbed(false);
  }

  function onPause() {
    setIsPlaying(false);
  }

  const onPlayerReady = useCallback(
    (player: Player) => {
      if (!embedded) {
        player.muted(muted);
        player.volume(volume);
      }

      const shouldPlay = !embedded || autoplayIfEmbedded;
      // https://blog.videojs.com/autoplay-best-practices-with-video-js/#Programmatic-Autoplay-and-Success-Failure-Detection
      if (shouldPlay) {
        const playPromise = player.play();
        const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => reject(PLAY_TIMEOUT_ERROR), 2000);
        });

        Promise.race([playPromise, timeoutPromise]).catch(error => {
          if (PLAY_TIMEOUT_ERROR) {
            const retryPlayPromise = player.play();
            Promise.race([retryPlayPromise, timeoutPromise]).catch(error => {
              setIsLoading(false);
              setIsPlaying(false);
            });
          } else {
            setIsLoading(false);
            setIsPlaying(false);
          }
        });
      }

      setIsLoading(shouldPlay); // if we are here outside of an embed, we're playing
      player.on('tracking:buffered', doTrackingBuffered);
      player.on('tracking:firstplay', doTrackingFirstPlay);
      player.on('ended', onEnded);
      player.on('play', onPlay);
      player.on('pause', onPause);
      player.on('volumechange', () => {
        if (player && player.volume() !== volume) {
          changeVolume(player.volume());
        }
        if (player && player.muted() !== muted) {
          changeMute(player.muted());
        }
      });

      if (position) {
        player.currentTime(position);
      }
    },
    [uri]
  );

  return (
    <div
      className={classnames('file-viewer', {
        'file-viewer--is-playing': isPlaying,
        'file-viewer--ended-embed': isEndededEmbed,
      })}
      onContextMenu={stopContextMenu}
    >
      {showAutoplayCountdown && <AutoplayCountdown uri={uri} />}
      {isEndededEmbed && <FileViewerEmbeddedEnded uri={uri} />}
      {embedded && !isEndededEmbed && <FileViewerEmbeddedTitle uri={uri} />}
      {/* disable this loading behavior because it breaks when player.play() promise hangs */}
      {isLoading && <LoadingScreen status={__('Loading')} />}
      <VideoJs
        source={source}
        isAudio={isAudio}
        poster={isAudio || (embedded && !autoplayIfEmbedded) ? thumbnail : null}
        sourceType={forcePlayer ? 'video/mp4' : contentType}
        onPlayerReady={onPlayerReady}
        startMuted={autoplayIfEmbedded}
      />
    </div>
  );
}

export default VideoViewer;
