package org.transformice;

import java.util.Arrays;
import org.bytearray.ByteArray;
import org.jboss.netty.buffer.ChannelBuffer;
import org.jboss.netty.buffer.ChannelBuffers;
import org.jboss.netty.handler.codec.embedder.DecoderEmbedder;
import org.jboss.netty.handler.codec.frame.CorruptedFrameException;
import org.transformice.connection.Decoder;

/** Run after mvn test-compile dependency:copy-dependencies -DoutputDirectory=target/deps:
 * java -cp 'target/test-classes:target/classes:target/deps/*' org.transformice.DecoderTest
 */
public final class DecoderTest extends Decoder {
    public static void main(String[] args) throws Exception {
        DecoderTest decoder = new DecoderTest();
        ChannelBuffer input = ChannelBuffers.wrappedBuffer(new byte[] {2, 7, 0, 11, 3, 8, 26});
        check(Arrays.equals(((ByteArray) decoder.decode(null, null, input)).toByteArray(), new byte[] {7, 0, 11}), "first frame");
        check(decoder.decode(null, null, input) == null, "partial trailing frame must wait");
        // Check directly before using Netty's loop, so the old bug fails instead of hanging.
        check(input.readerIndex() == 4, "partial frame rewound over a delivered packet (infinite replay)");

        input = ChannelBuffers.wrappedBuffer(new byte[] {3, 7, 28, 6});
        check(decoder.decode(null, null, input) == null && input.readerIndex() == 0, "wait for the extra fingerprint byte");

        byte[] small = {7, 28, 6, 1};
        byte[] large = new byte[131];
        Arrays.fill(large, (byte) 42);
        ChannelBuffer stream = ChannelBuffers.dynamicBuffer();
        stream.writeByte(small.length - 1);
        stream.writeBytes(small);
        stream.writeBytes(new byte[] {(byte) 0x82, 1}); // 130, excluding fingerprint
        stream.writeBytes(large);
        stream.writeByte(small.length - 1);
        stream.writeBytes(small);
        byte[] wire = new byte[stream.readableBytes()];
        stream.readBytes(wire);
        for (int split = 1; split < wire.length; split++) {
            DecoderEmbedder<ByteArray> embedded = new DecoderEmbedder<>(new Decoder());
            embedded.offer(ChannelBuffers.wrappedBuffer(Arrays.copyOfRange(wire, 0, split)));
            embedded.offer(ChannelBuffers.wrappedBuffer(Arrays.copyOfRange(wire, split, wire.length)));
            check(Arrays.equals(embedded.poll().toByteArray(), small), "first packet at split " + split);
            check(Arrays.equals(embedded.poll().toByteArray(), large), "large packet at split " + split);
            check(Arrays.equals(embedded.poll().toByteArray(), small), "last packet at split " + split);
            check(embedded.poll() == null && !embedded.finish(), "duplicated packet at split " + split);
        }

        byte[] policy = "<policy-file-request/>\0".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        for (int split = 1; split < policy.length; split++) {
            input = ChannelBuffers.wrappedBuffer(Arrays.copyOf(policy, split));
            check(decoder.decode(null, null, input) == null && input.readerIndex() == 0, "partial policy request");
        }

        for (byte[] invalid : new byte[][] {
            {0, 0}, {1, 0},
            {(byte) 0x81, (byte) 0x80, 0x40}, // larger than 1 MiB
            {(byte) 0xff, (byte) 0xff, (byte) 0xff, (byte) 0xff, 0x7f}, // integer overflow
            {(byte) 0x82, (byte) 0x80, (byte) 0x80, (byte) 0x80, 0x10}, // overflow must not wrap to length 2
            {(byte) 0x80, (byte) 0x80, (byte) 0x80, (byte) 0x80, (byte) 0x80, 0}
        }) {
            try {
                decoder.decode(null, null, ChannelBuffers.wrappedBuffer(invalid));
                throw new AssertionError("accepted invalid length " + Arrays.toString(invalid));
            } catch (CorruptedFrameException expected) {
                // Malformed frames must fail before allocation or waiting for their payload.
            }
        }
        check(Server.createClientPipeline(null).get("decoder") != Server.createClientPipeline(null).get("decoder"),
            "each TCP connection needs its own decoder/cumulation buffer");
        System.out.println("Decoder regression passed: replay, fragmentation, policy prefix, invalid lengths, connection isolation");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
