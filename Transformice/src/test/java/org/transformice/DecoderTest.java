package org.transformice;

import java.util.Arrays;
import org.bytearray.ByteArray;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.CorruptedFrameException;
import org.transformice.connection.Decoder;

/** Run after mvn test-compile dependency:copy-dependencies -DoutputDirectory=target/deps:
 * java -cp 'target/test-classes:target/classes:target/deps/*' org.transformice.DecoderTest
 */
public final class DecoderTest extends Decoder {
    public static void main(String[] args) throws Exception {
        DecoderTest decoder = new DecoderTest();
        ByteBuf input = Unpooled.wrappedBuffer(new byte[] {2, 7, 0, 11, 3, 8, 26});
        check(Arrays.equals(((ByteArray) decoder.decodeOne(input)).toByteArray(), new byte[] {7, 0, 11}), "first frame");
        check(decoder.decodeOne(input) == null, "partial trailing frame must wait");
        // Check directly before using Netty's loop, so the old bug fails instead of hanging.
        check(input.readerIndex() == 4, "partial frame rewound over a delivered packet (infinite replay)");

        input = Unpooled.wrappedBuffer(new byte[] {3, 7, 28, 6});
        check(decoder.decodeOne(input) == null && input.readerIndex() == 0, "wait for the extra fingerprint byte");

        byte[] small = {7, 28, 6, 1};
        byte[] large = new byte[131];
        Arrays.fill(large, (byte) 42);
        ByteBuf stream = Unpooled.buffer();
        stream.writeByte(small.length - 1);
        stream.writeBytes(small);
        stream.writeBytes(new byte[] {(byte) 0x82, 1}); // 130, excluding fingerprint
        stream.writeBytes(large);
        stream.writeByte(small.length - 1);
        stream.writeBytes(small);
        byte[] wire = new byte[stream.readableBytes()];
        stream.readBytes(wire);
        for (int split = 1; split < wire.length; split++) {
            EmbeddedChannel embedded = new EmbeddedChannel(new Decoder());
            embedded.writeInbound(Unpooled.wrappedBuffer(Arrays.copyOfRange(wire, 0, split)));
            embedded.writeInbound(Unpooled.wrappedBuffer(Arrays.copyOfRange(wire, split, wire.length)));
            check(Arrays.equals(((ByteArray) embedded.readInbound()).toByteArray(), small), "first packet at split " + split);
            check(Arrays.equals(((ByteArray) embedded.readInbound()).toByteArray(), large), "large packet at split " + split);
            check(Arrays.equals(((ByteArray) embedded.readInbound()).toByteArray(), small), "last packet at split " + split);
            check(embedded.readInbound() == null && !embedded.finish(), "duplicated packet at split " + split);
        }

        byte[] policy = "<policy-file-request/>\0".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        for (int split = 1; split < policy.length; split++) {
            input = Unpooled.wrappedBuffer(Arrays.copyOf(policy, split));
            check(decoder.decodeOne(input) == null && input.readerIndex() == 0, "partial policy request");
        }

        for (byte[] invalid : new byte[][] {
            {0, 0}, {1, 0},
            {(byte) 0x81, (byte) 0x80, 0x40}, // larger than 1 MiB
            {(byte) 0xff, (byte) 0xff, (byte) 0xff, (byte) 0xff, 0x7f}, // integer overflow
            {(byte) 0x82, (byte) 0x80, (byte) 0x80, (byte) 0x80, 0x10}, // overflow must not wrap to length 2
            {(byte) 0x80, (byte) 0x80, (byte) 0x80, (byte) 0x80, (byte) 0x80, 0}
        }) {
            try {
                decoder.decodeOne(Unpooled.wrappedBuffer(invalid));
                throw new AssertionError("accepted invalid length " + Arrays.toString(invalid));
            } catch (CorruptedFrameException expected) {
                // Malformed frames must fail before allocation or waiting for their payload.
            }
        }
        EmbeddedChannel policyChannel = new EmbeddedChannel(new org.transformice.connection.Encoder(), new Decoder());
        policyChannel.writeInbound(Unpooled.wrappedBuffer(policy));
        ByteBuf response = policyChannel.readOutbound();
        check(response != null && response.toString(java.nio.charset.StandardCharsets.UTF_8).contains("<cross-domain-policy>"), "policy response is encoded and flushed");
        response.release();
        policyChannel.finishAndReleaseAll();
        check(Server.createClientHandlers(null)[1] != Server.createClientHandlers(null)[1],
            "each TCP connection needs its own decoder/cumulation buffer");
        System.out.println("Decoder regression passed: replay, fragmentation, policy prefix, invalid lengths, connection isolation");
    }

    private Object decodeOne(ByteBuf input) {
        java.util.List<Object> output = new java.util.ArrayList<>();
        decode(null, input, output);
        return output.isEmpty() ? null : output.getFirst();
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
